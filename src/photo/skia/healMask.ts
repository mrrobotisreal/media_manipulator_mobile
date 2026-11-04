/**
 * The heal mask at base resolution (ticket MA51 decision 5): the spot strokes (already mapped to
 * base pixels by `tools/heal.ts`) drawn white on opaque black, round caps and joins, on a CPU
 * raster surface of EXACTLY the base size (the API's `healMask` refuses any other size), encoded
 * as PNG. Equivalent to the web's `HealStrokes.maskRgba()` (hardness 80 dabs thresholded at 5 %:
 * a hard disc of ~0.99 of the diameter). The caller caps the size (50 MP).
 */
import type { SkiaApi } from './shaderChain';
import type { Point } from '../tools/canvasMath';

const PNG = 4; // ImageFormat.PNG
const STROKE = 1; // PaintStyle.Stroke
const ROUND_CAP = 1;
const ROUND_JOIN = 1;

export function renderHealMaskPng(
  api: SkiaApi,
  strokes: readonly { pts: Point[]; diameter: number }[],
  size: { width: number; height: number },
): Uint8Array {
  const surface = api.Surface.Make(size.width, size.height);
  if (!surface) throw new Error(`heal mask surface ${size.width}x${size.height}`);
  const canvas = surface.getCanvas();
  canvas.clear(api.Color('black'));
  const paint = api.Paint();
  paint.setColor(api.Color('white'));
  paint.setAntiAlias(false);
  paint.setStyle(STROKE);
  paint.setStrokeCap(ROUND_CAP);
  paint.setStrokeJoin(ROUND_JOIN);
  for (const s of strokes) {
    if (s.pts.length === 0) continue;
    paint.setStrokeWidth(Math.max(1, s.diameter * 0.99));
    const path = api.Path.Make();
    path.moveTo(s.pts[0]!.x, s.pts[0]!.y);
    if (s.pts.length === 1) path.lineTo(s.pts[0]!.x + 0.01, s.pts[0]!.y);
    for (const p of s.pts.slice(1)) path.lineTo(p.x, p.y);
    canvas.drawPath(path, paint);
  }
  surface.flush();
  return surface.makeImageSnapshot().encodeToBytes(PNG, 100);
}
