/**
 * Pixels behind brush and subject mask components on the phone (the web's `maskAssets.ts`, on
 * Skia). The doc carries a brush as a PNG data URI (coverage in alpha) and a subject as a server
 * ref (`masks/<id>.png`, an 8-bit grey PNG: white = subject; alpha when the PNG has one, like the
 * web's rule). Both become an opaque grey raster the mask passes read in `.r`.
 *
 * Subject PNGs are cached on disk under `cache/photo/<projectId>/masks/` (ticket decision 3) and
 * decoded at most `SUBJECT_MAX_SIDE` on the long side (the pipeline samples masks bilinear in
 * normalized coordinates, so any size works). The Skia API and the file I/O are injected.
 *
 * react-native-skia 3 (MA60): readback is a promise, so the alpha rule (`hasTransparency`) and the
 * 8-bit alpha `alphaOf` returns are read once, asynchronously, while a raster loads; `alphaOf`
 * itself stays synchronous (the brush reads it at gesture start) and only reads that cache.
 */
import type { SkImage } from 'react-native-skia';
import type { AlphaImage } from '../colorMath';
import { docAssetIds } from '../maskAssets';
import type { PhotoDoc } from '../photoTypes';
import type { AlphaSource } from './pipeline';
import { disposeLater, disposeNow } from './lifetime';
import { pixelBytes } from './readback';
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

/** RGBA8 (unpremultiplied) of a whole image, or null when Skia reads nothing. */
async function rgbaOf(img: SkImage): Promise<Uint8Array | null> {
  const w = img.width();
  const h = img.height();
  return pixelBytes(
    await img.readPixels(0, 0, { width: w, height: h, colorType: 4, alphaType: 3 }),
  );
}

/** Any pixel with alpha < 255 (the web's rule for subject PNGs: alpha if transparent, else red). */
export async function hasTransparency(img: SkImage): Promise<boolean> {
  const px = await rgbaOf(img);
  if (!px) return false;
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
    const old = this.images.get(id);
    this.images.set(id, grey);
    // A replaced raster may still be sampled by the picture on screen this frame (MA60).
    if (old && old !== grey) disposeLater([old]);
    this.listeners.forEach((l) => l());
  }

  /** Releases every raster (the editor unmounted). */
  dispose(): void {
    disposeNow([...this.images.values()]);
    this.images.clear();
    this.alphas.clear();
  }

  /**
   * The 8-bit alpha of a loaded raster (brush continuation, crop re-map). Read back once, while the
   * raster loads (`load`), or given by `putAlpha`; null until then.
   */
  alphaOf(id: string): AlphaImage | null {
    return this.alphas.get(id) ?? null;
  }

  /** Read a grey raster's `.r` back as the 8-bit alpha (async on Skia 3). */
  private async readAlpha(img: SkImage): Promise<AlphaImage | null> {
    const px = await rgbaOf(img);
    if (!px) return null;
    const w = img.width();
    const h = img.height();
    const alpha = new Uint8Array(w * h);
    for (let i = 0; i < alpha.length; i += 1) alpha[i] = px[i * 4]!;
    return { width: w, height: h, alpha };
  }

  /** A brush baked on the phone: install its raster from the alpha (no PNG decode). */
  putAlpha(id: string, a: AlphaImage): void {
    const rgba = new Uint8Array(a.width * a.height * 4);
    for (let i = 0; i < a.width * a.height; i += 1) {
      const v = a.alpha[i] as number;
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v;
      rgba[i * 4 + 3] = 255;
    }
    const img = this.api.Image.MakeRaster(
      { width: a.width, height: a.height, colorType: 4, alphaType: ALPHA_OPAQUE },
      this.api.Data.fromBytes(rgba),
      a.width * 4,
    );
    if (!img) return;
    this.alphas.set(id, a);
    this.put(id, img);
  }

  /** Grey raster of an encoded PNG: alpha for brushes; for subjects alpha when the PNG has any. */
  async toGrey(
    encoded: SkImage,
    kind: 'brush' | 'subject',
    maxSide = Infinity,
  ): Promise<SkImage | null> {
    if (!this.effect) this.effect = this.api.RuntimeEffect.Make(GREY_SKSL);
    if (!this.effect) return null;
    const w0 = encoded.width();
    const h0 = encoded.height();
    const k = Math.min(1, maxSide / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * k));
    const h = Math.max(1, Math.round(h0 * k));
    const useAlpha = kind === 'brush' || (await hasTransparency(encoded));
    const s =
      (this.gpu ? this.api.Surface.MakeOffscreen(w, h) : null) ?? this.api.Surface.MakeRaster(w, h);
    if (!s) return null;
    const img = encoded.makeShaderOptions(0, 0, k < 1 ? 1 : 0, 0, this.api.Matrix().scale(k, k));
    const grey = this.effect.makeShaderWithChildren([useAlpha ? 1 : 0], [img]);
    const paint = this.api.Paint();
    try {
      paint.setBlendMode(BLEND_SRC);
      paint.setShader(grey);
      s.getCanvas().drawRect(this.api.XYWHRect(0, 0, w, h), paint);
      s.flush();
      // Skia 3 (Graphite): a GPU snapshot is shared by every canvas; no raster copy (MA60). The
      // surface, the paint and the shaders (which pin the decoded PNG) go right away; the
      // snapshot keeps the pixels.
      return s.makeImageSnapshot();
    } finally {
      disposeNow([paint, grey, img, s]);
    }
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
        const decoded = this.api.Image.MakeFromEncoded(data);
        if (!decoded) return null;
        let grey: SkImage | null;
        try {
          grey = await this.toGrey(decoded, kind, kind === 'subject' ? SUBJECT_MAX_SIDE : Infinity);
        } finally {
          // The grey raster is a new image; the decoded PNG is no longer needed.
          disposeNow([decoded]);
        }
        if (!grey) return null;
        // The alpha is read before the raster is announced, so `alphaOf` has it from then on.
        if (!this.alphas.has(id)) {
          const a = await this.readAlpha(grey);
          if (a) this.alphas.set(id, a);
        }
        this.put(id, grey);
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
