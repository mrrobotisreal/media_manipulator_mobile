/**
 * Pixels behind brush and subject mask components on the phone (the web's `maskAssets.ts`, on
 * Skia). The doc carries a brush as a PNG data URI (coverage in alpha) and a subject as a server
 * ref (`masks/<id>.png`, an 8-bit grey PNG: white = subject; alpha when the PNG has one, like the
 * web's rule). Both become an opaque grey raster the mask passes read in `.r`.
 *
 * Subject PNGs are cached on disk under `cache/photo/<projectId>/masks/` (ticket decision 3) and
 * decoded at most `SUBJECT_MAX_SIDE` on the long side (the pipeline samples masks bilinear in
 * normalized coordinates, so any size works). The Skia API and the file I/O are injected.
 */
import type { SkImage } from '@shopify/react-native-skia';
import type { AlphaImage } from '../colorMath';
import { docAssetIds } from '../maskAssets';
import type { PhotoDoc } from '../photoTypes';
import type { AlphaSource } from './pipeline';
import type { SkiaApi } from './shaderChain';

export const SUBJECT_MAX_SIDE = 2048;
const ALPHA_OPAQUE = 1;
const BLEND_SRC = 1;

const GREY_SKSL = `
uniform shader uImage;
uniform float uUseAlpha;
float4 main(float2 p) {
  float4 c = uImage.eval(p);
  float v = uUseAlpha > 0.5 ? c.a : (c.a > 0.0 ? c.r / c.a : 0.0);
  return float4(v, v, v, 1.0);
}
`;

/** Any pixel with alpha < 255 (the web's rule for subject PNGs: alpha if transparent, else red). */
function hasTransparency(img: SkImage): boolean {
  const w = img.width();
  const h = img.height();
  const px = img.readPixels(0, 0, { width: w, height: h, colorType: 4, alphaType: 3 });
  if (!(px instanceof Uint8Array)) return false;
  for (let i = 3; i < px.length; i += 4) if (px[i] !== 255) return true;
  return false;
}

export interface MaskAssetIo {
  /** Bytes of the subject mask PNG for `maskRef` (from the cache, downloading when missing). */
  subjectBytes(maskRef: string): Promise<Uint8Array | null>;
}

export class MaskAssetStore implements AlphaSource {
  private images = new Map<string, SkImage>();
  private alphas = new Map<string, AlphaImage>();
  private pending = new Map<string, Promise<SkImage | null>>();
  private listeners = new Set<() => void>();
  private effect: ReturnType<SkiaApi['RuntimeEffect']['Make']> = null;

  constructor(
    private readonly api: SkiaApi,
    private readonly io: MaskAssetIo,
    private readonly gpu = false,
  ) {}

  get(id: string): SkImage | null {
    return this.images.get(id) ?? null;
  }

  has(id: string): boolean {
    return this.images.has(id);
  }

  /** Called when a raster arrives (the pipeline drops its masks and the canvas redraws). */
  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Install a raster made on the phone (a fresh brush bake) without a decode round trip. */
  put(id: string, grey: SkImage): void {
    this.images.set(id, grey);
    this.listeners.forEach((l) => l());
  }

  /** The 8-bit alpha of a loaded raster (brush continuation, crop re-map), read back once. */
  alphaOf(id: string): AlphaImage | null {
    const hit = this.alphas.get(id);
    if (hit) return hit;
    const img = this.images.get(id);
    if (!img) return null;
    const w = img.width();
    const h = img.height();
    const px = img.readPixels(0, 0, { width: w, height: h, colorType: 4, alphaType: 3 });
    if (!(px instanceof Uint8Array)) return null;
    const alpha = new Uint8Array(w * h);
    for (let i = 0; i < alpha.length; i += 1) alpha[i] = px[i * 4]!;
    const a = { width: w, height: h, alpha };
    this.alphas.set(id, a);
    return a;
  }

  /** A brush baked on the phone: install its raster from the alpha (no PNG decode). */
  putAlpha(id: string, a: AlphaImage): void {
    const rgba = new Uint8Array(a.width * a.height * 4);
    for (let i = 0; i < a.width * a.height; i += 1) {
      const v = a.alpha[i] as number;
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v;
      rgba[i * 4 + 3] = 255;
    }
    const img = this.api.Image.MakeImage(
      { width: a.width, height: a.height, colorType: 4, alphaType: ALPHA_OPAQUE },
      this.api.Data.fromBytes(rgba),
      a.width * 4,
    );
    if (!img) return;
    this.alphas.set(id, a);
    this.put(id, img);
  }

  /** Grey raster of an encoded PNG: alpha for brushes; for subjects alpha when the PNG has any. */
  toGrey(encoded: SkImage, kind: 'brush' | 'subject', maxSide = Infinity): SkImage | null {
    if (!this.effect) this.effect = this.api.RuntimeEffect.Make(GREY_SKSL);
    if (!this.effect) return null;
    const w0 = encoded.width();
    const h0 = encoded.height();
    const k = Math.min(1, maxSide / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * k));
    const h = Math.max(1, Math.round(h0 * k));
    const useAlpha = kind === 'brush' || hasTransparency(encoded);
    const img = encoded.makeShaderOptions(0, 0, k < 1 ? 1 : 0, 0, this.api.Matrix().scale(k, k));
    const s =
      (this.gpu ? this.api.Surface.MakeOffscreen(w, h) : null) ?? this.api.Surface.Make(w, h);
    if (!s) return null;
    const paint = this.api.Paint();
    paint.setBlendMode(BLEND_SRC);
    paint.setShader(this.effect.makeShaderWithChildren([useAlpha ? 1 : 0], [img]));
    s.getCanvas().drawRect(this.api.XYWHRect(0, 0, w, h), paint);
    s.flush();
    const out = s.makeImageSnapshot();
    return this.gpu ? (out.makeNonTextureImage() ?? out) : out;
  }

  private load(id: string, kind: 'brush' | 'subject'): Promise<SkImage | null> {
    const hit = this.images.get(id);
    if (hit) return Promise.resolve(hit);
    const run = this.pending.get(id);
    if (run) return run;
    const p = (async () => {
      try {
        let data;
        if (kind === 'brush') {
          const m = /^data:image\/png;base64,(.*)$/.exec(id);
          if (!m) return null;
          data = this.api.Data.fromBase64(m[1]!);
        } else {
          const bytes = await this.io.subjectBytes(id);
          if (!bytes) return null;
          data = this.api.Data.fromBytes(bytes);
        }
        const decoded = this.api.Image.MakeImageFromEncoded(data);
        if (!decoded) return null;
        const grey = this.toGrey(decoded, kind, kind === 'subject' ? SUBJECT_MAX_SIDE : Infinity);
        if (grey) this.put(id, grey);
        return grey;
      } catch {
        return null;
      } finally {
        this.pending.delete(id);
      }
    })();
    this.pending.set(id, p);
    return p;
  }

  /** Decode every brush / subject raster the doc uses that is not loaded yet. */
  async ensure(doc: Pick<PhotoDoc, 'layers' | 'masks'>): Promise<void> {
    await Promise.all(
      docAssetIds(doc)
        .filter((a) => !this.images.has(a.id))
        .map((a) => this.load(a.id, a.kind)),
    );
  }
}
