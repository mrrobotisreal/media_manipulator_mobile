/**
 * Pure touch-tool maths (ticket MA51 decision 3): screen points on the canvas → normalized
 * coordinates of the geometry-corrected image (masks live there, as on the web), and the doc
 * edits each gesture makes. Worklet-free: the overlay calls these on the JS thread at gesture
 * end (and at a throttled rate while dragging), so they stay unit-testable.
 */
import { radialFromDrag, gradientFromDrag } from '../toolMath';
import { maskComponentSchema, type MaskComponent, type PhotoDoc } from '../photoTypes';
import {
  addComponent,
  addRedEye,
  addColorTarget,
  maskOfLayer,
  MAX_COLOR_TARGETS,
} from '../maskOps';

export interface Point {
  x: number;
  y: number;
}

/** The canvas view: image size (output pixels) and the transform the canvas draws with. */
export interface ViewState {
  canvasW: number;
  canvasH: number;
  imageW: number;
  imageH: number;
  /** Screen points per image pixel. */
  scale: number;
  /** Image-centre offset from the canvas centre, points. */
  tx: number;
  ty: number;
}

/** Screen point (canvas-local, LTR) → image pixel. */
export function screenToImage(v: ViewState, p: Point): Point {
  const ox = v.canvasW / 2 + v.tx - (v.imageW * v.scale) / 2;
  const oy = v.canvasH / 2 + v.ty - (v.imageH * v.scale) / 2;
  return { x: (p.x - ox) / v.scale, y: (p.y - oy) / v.scale };
}

/** Image pixel → screen point. */
export function imageToScreen(v: ViewState, p: Point): Point {
  const ox = v.canvasW / 2 + v.tx - (v.imageW * v.scale) / 2;
  const oy = v.canvasH / 2 + v.ty - (v.imageH * v.scale) / 2;
  return { x: ox + p.x * v.scale, y: oy + p.y * v.scale };
}

/** Screen point → normalized (0..1) geometry space; may fall outside when off the image. */
export function screenToNorm(v: ViewState, p: Point): Point {
  const i = screenToImage(v, p);
  return { x: i.x / v.imageW, y: i.y / v.imageH };
}

export const normToScreen = (v: ViewState, n: Point): Point =>
  imageToScreen(v, { x: n.x * v.imageW, y: n.y * v.imageH });

export const insideImage = (n: Point) => n.x >= 0 && n.x <= 1 && n.y >= 0 && n.y <= 1;

/** Round to 4 decimals (keeps the doc readable; well below a pixel at 24 MP). */
const r4 = (v: number) => Math.round(v * 10_000) / 10_000;
const pt = (p: Point) => ({ x: r4(p.x), y: r4(p.y) });

/** A gradient component from a drag (normalized from → to). Too short a drag → null. */
export function gradientComponent(a: Point, b: Point, feather = 0.25): MaskComponent | null {
  if (Math.hypot(b.x - a.x, b.y - a.y) < 0.01) return null;
  const g = gradientFromDrag(pt(a), pt(b));
  return maskComponentSchema.parse({ kind: 'gradient', mode: 'add', ...g, feather });
}

/**
 * A radial component from a drag: centre where the finger went down, half-axes from the drag box
 * (normalized per axis, so a circle on screen stays a circle on a non-square photo when the drag
 * is diagonal). Too small → null.
 */
export function radialComponent(center: Point, edge: Point, rotate = 0, feather = 0.4) {
  const r = radialFromDrag(pt(center), pt(edge), rotate);
  if (r.rx < 0.005 && r.ry < 0.005) return null;
  return maskComponentSchema.parse({
    kind: 'radial',
    mode: 'add',
    ...r,
    rx: Math.max(0.005, r4(r.rx)),
    ry: Math.max(0.005, r4(r.ry)),
    feather,
  });
}

/** Rotation handle: the angle (degrees, clockwise, y down) of the handle around the centre. */
export function handleAngle(center: Point, handle: Point, aspect = 1): number {
  const a = (Math.atan2(handle.y - center.y, (handle.x - center.x) * aspect) * 180) / Math.PI;
  return Math.round(a * 10) / 10;
}

/**
 * Colour range from the eyedropper: the RGB under the finger (from `readPixels` of the rendered
 * preview, what the user sees, like the web) added to the selected component; replace = a fresh
 * single target (tap), add = append (long press), capped at 8.
 */
export function pixelAt(
  pixels: Uint8Array,
  width: number,
  height: number,
  n: Point,
): { r: number; g: number; b: number } | null {
  if (!insideImage(n)) return null;
  const x = Math.min(width - 1, Math.max(0, Math.floor(n.x * width)));
  const y = Math.min(height - 1, Math.max(0, Math.floor(n.y * height)));
  const o = (y * width + x) * 4;
  return { r: pixels[o]!, g: pixels[o + 1]!, b: pixels[o + 2]! };
}

export function pickColorTarget(
  doc: PhotoDoc,
  layerId: string,
  index: number,
  rgb: { r: number; g: number; b: number },
  add: boolean,
): PhotoDoc {
  const m = maskOfLayer(doc, layerId);
  const c = m?.components[index];
  if (c?.kind !== 'colorRange') {
    // No colour-range component selected yet: start one with this target.
    return addComponent(
      doc,
      layerId,
      maskComponentSchema.parse({ kind: 'colorRange', mode: 'add', colors: [rgb] }),
    );
  }
  if (add && c.colors.length >= MAX_COLOR_TARGETS) return doc;
  return addColorTarget(doc, layerId, index, rgb, add);
}

/** Red-eye: a `redEye` layer with a radial mask where the eye was tapped. */
export function redEyeAt(
  doc: PhotoDoc,
  n: Point,
  radiusPercent: number,
  outW: number,
  outH: number,
): { doc: PhotoDoc; layerId: string } | null {
  if (!insideImage(n)) return null;
  return addRedEye(doc, r4(n.x), r4(n.y), radiusPercent / 100, outW, outH);
}
