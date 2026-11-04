/**
 * The brush on the phone (ticket MA51 decision 3). The live stroke is a Skia path the overlay
 * draws (cheap, on the UI thread); on gesture end the stroke is stamped into the web's
 * `BrushRaster` (the copied `brushEngine.ts`: the same dabs, hardness falloff and flow as the
 * browser, in geometry space at <= 1024 px on the long side) and baked to a PNG data URI under
 * the 512 KB cap (halving like the web's `bakeBrush`). The PNG is encoded by Skia
 * (`encodeToBase64`); tests inject pngjs.
 */
import {
  bakeBrush,
  brushRasterSize,
  BrushRaster,
  type BrushSettings,
  type PngEncoder,
} from '../brushEngine';
import type { AlphaImage } from '../colorMath';
import type { PhotoDoc } from '../photoTypes';
import { brushBudget, brushPngTooBig, maskOfLayer, setBrushComponent } from '../maskOps';
import type { Point } from './canvasMath';

export interface BrushSession {
  raster: BrushRaster;
  /** Index of the brush component being edited (undefined = append a new one). */
  index?: number;
  /** Output (geometry-corrected) size the raster covers. */
  outW: number;
  outH: number;
}

/**
 * Start painting on a layer: the raster continues the layer's selected brush component (decoded
 * `existing`) or starts empty.
 */
export function beginBrush(
  outW: number,
  outH: number,
  existing: AlphaImage | null,
  index?: number,
): BrushSession {
  const size = brushRasterSize(outW, outH);
  return { raster: BrushRaster.from(existing, size.width, size.height), index, outW, outH };
}

/**
 * Stamp one stroke (normalized points) with the brush settings. `size` is the diameter in
 * SOURCE (output) pixels, 1..500 (ticket: "size 1–500 source px"), scaled to the raster.
 */
export function paintStroke(s: BrushSession, pts: Point[], brush: BrushSettings): void {
  if (pts.length === 0) return;
  const k = s.raster.width / s.outW;
  const d = Math.max(1, brush.size * k);
  const map = (p: Point) => ({ x: p.x * s.raster.width, y: p.y * s.raster.height });
  const settings = { hardness: brush.hardness, flow: brush.flow, erase: brush.erase };
  if (pts.length === 1) {
    const p = map(pts[0]!);
    s.raster.stamp(p.x, p.y, d, settings);
    return;
  }
  for (let i = 1; i < pts.length; i += 1)
    s.raster.stroke(map(pts[i - 1]!), map(pts[i]!), d, settings);
}

export type BakeResult =
  | { ok: true; doc: PhotoDoc; png: string; width: number; height: number; alpha: AlphaImage }
  | { ok: false; reason: 'full' | 'too_big' | 'no_layer' };

/** Bake the raster and install it on the layer's mask (one doc edit). */
export async function bakeInto(
  doc: PhotoDoc,
  layerId: string,
  s: BrushSession,
  encode: PngEncoder,
): Promise<BakeResult> {
  if (!doc.layers.some((l) => l.id === layerId)) return { ok: false, reason: 'no_layer' };
  if (brushBudget(doc).full && s.index === undefined) return { ok: false, reason: 'full' };
  const baked = await bakeBrush(s.raster, encode);
  if (brushPngTooBig(baked.png)) return { ok: false, reason: 'too_big' };
  const next = setBrushComponent(doc, layerId, baked.png, baked.width, baked.height, s.index);
  const alpha =
    baked.width === s.raster.width
      ? s.raster.toAlphaImage()
      : BrushRaster.from(s.raster.toAlphaImage(), baked.width, baked.height).toAlphaImage();
  return { ok: true, doc: next, ...baked, alpha };
}

/** Index of the layer's brush component the brush continues (the selected one, else the first). */
export function brushIndexOf(doc: PhotoDoc, layerId: string, selected: number): number | undefined {
  const comps = maskOfLayer(doc, layerId)?.components ?? [];
  if (comps[selected]?.kind === 'brush') return selected;
  const i = comps.findIndex((c) => c.kind === 'brush');
  return i >= 0 ? i : undefined;
}

/**
 * Skia PNG encoder for the phone: RGBA bytes → `Image.MakeImage` → `encodeToBase64()` (the ticket's
 * `makeImageSnapshot().encodeToBase64()` without the extra surface).
 */
export function skiaPngEncoder(api: {
  Image: { MakeImage: (...a: never[]) => { encodeToBase64(): string } | null };
  Data: { fromBytes: (b: Uint8Array) => unknown };
}): PngEncoder {
  return async (rgba, width, height) => {
    const img = (
      api.Image.MakeImage as unknown as (
        info: object,
        data: unknown,
        rowBytes: number,
      ) => { encodeToBase64(): string } | null
    )(
      { width, height, colorType: 4, alphaType: 3 },
      api.Data.fromBytes(new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength)),
      width * 4,
    );
    if (!img) throw new Error('brush encode');
    return `data:image/png;base64,${img.encodeToBase64()}`;
  };
}
