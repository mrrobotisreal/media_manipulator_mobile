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

export interface MaskAssetIo {
  /** Bytes of the subject mask PNG for `maskRef` (from the cache, downloading when missing). */
  subjectBytes(maskRef: string): Promise<Uint8Array | null>;
}

export class MaskAssetStore implements AlphaSource {
  private images = new Map<string, SkImage>();
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

  /** Grey raster of an encoded PNG: alpha for brushes; for subjects alpha when the PNG has any. */
  toGrey(encoded: SkImage, kind: 'brush' | 'subject', maxSide = Infinity): SkImage | null {
    if (!this.effect) this.effect = this.api.RuntimeEffect.Make(GREY_SKSL);
    if (!this.effect) return null;
    const w0 = encoded.width();
    const h0 = encoded.height();
    const k = Math.min(1, maxSide / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * k));
    const h = Math.max(1, Math.round(h0 * k));
    const useAlpha = kind === 'brush' || encoded.getImageInfo().alphaType !== ALPHA_OPAQUE;
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
