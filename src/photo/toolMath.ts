// DO NOT EDIT. Copied from media-manipulator-ui lib/photo/toolMath.ts by scripts/sync-photo-fixtures.mjs
// (npm run photo:sync). The web repo is the source of the model and the math (ADR MA-0010);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/**
 * Pure maths for the canvas tools (MM98): crop rectangle handles with aspect
 * presets, the straighten line, perspective corners, gradient and radial
 * drags. Everything works in normalized coordinates of a canvas of known pixel
 * size so the aspect is a pixel aspect.
 */
import { autoCropRect } from './colorMath';
import type { Geometry } from './photoTypes';
import type { CropRect } from './maskOps';

export type AspectPreset = 'free' | '1:1' | '4:3' | '3:2' | '16:9' | '9:16' | '4:5' | '5:4' | 'original';
export const ASPECT_PRESETS: AspectPreset[] = ['free', '1:1', '4:3', '3:2', '16:9', '9:16', '4:5', '5:4', 'original'];

/** Pixel aspect (w/h) of a preset; null = free; `original` = the source aspect. */
export function aspectValue(p: AspectPreset, sourceW: number, sourceH: number): number | null {
  if (p === 'free') return null;
  if (p === 'original') return sourceW / sourceH;
  const [a, b] = p.split(':').map(Number);
  return a / b;
}

/** Largest centred rect of pixel aspect `aspect` in a `cw`×`ch` canvas (normalized). */
export function fitAspectRect(aspect: number, cw: number, ch: number): CropRect {
  let w = cw;
  let h = w / aspect;
  if (h > ch) {
    h = ch;
    w = h * aspect;
  }
  return { x: (cw - w) / 2 / cw, y: (ch - h) / 2 / ch, width: w / cw, height: h / ch };
}

export type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move';
const MIN_PX = 8;

/**
 * Drag a crop handle by (dx, dy) normalized units from the rect `r0`. Free
 * crops move the dragged edges; with an `aspect` the dragged corner/edge keeps
 * the aspect (corner: opposite corner anchored; edge: the perpendicular axis
 * grows about the rect's centre). The result is clamped inside the canvas and
 * never smaller than 8 px.
 */
export function dragCrop(r0: CropRect, handle: CropHandle, dx: number, dy: number, cw: number, ch: number, aspect: number | null): CropRect {
  if (handle === 'move') {
    return { ...r0, x: Math.min(1 - r0.width, Math.max(0, r0.x + dx)), y: Math.min(1 - r0.height, Math.max(0, r0.y + dy)) };
  }
  let l = r0.x;
  let t = r0.y;
  let r = r0.x + r0.width;
  let b = r0.y + r0.height;
  if (handle.includes('w')) l += dx;
  if (handle.includes('e')) r += dx;
  if (handle.includes('n')) t += dy;
  if (handle.includes('s')) b += dy;
  const minW = MIN_PX / cw;
  const minH = MIN_PX / ch;
  l = Math.max(0, Math.min(l, r - minW));
  r = Math.min(1, Math.max(r, l + minW));
  t = Math.max(0, Math.min(t, b - minH));
  b = Math.min(1, Math.max(b, t + minH));
  if (aspect) {
    const isCorner = handle.length === 2;
    // Fix the anchor: the opposite corner / edge-centre of the dragged handle.
    const ax = handle.includes('w') ? r0.x + r0.width : handle.includes('e') ? r0.x : r0.x + r0.width / 2;
    const ay = handle.includes('n') ? r0.y + r0.height : handle.includes('s') ? r0.y : r0.y + r0.height / 2;
    let w = (r - l) * cw;
    let h = (b - t) * ch;
    if (isCorner) {
      // follow the larger move
      if (w / aspect > h) h = w / aspect;
      else w = h * aspect;
    } else if (handle === 'n' || handle === 's') w = h * aspect;
    else h = w / aspect;
    // room available from the anchor
    const roomX = (handle.includes('w') ? ax : handle.includes('e') ? 1 - ax : Math.min(ax, 1 - ax) * 2) * cw;
    const roomY = (handle.includes('n') ? ay : handle.includes('s') ? 1 - ay : Math.min(ay, 1 - ay) * 2) * ch;
    const k = Math.min(1, roomX / w, roomY / h);
    w *= k;
    h *= k;
    const nw = w / cw;
    const nh = h / ch;
    const nx = handle.includes('w') ? ax - nw : handle.includes('e') ? ax : ax - nw / 2;
    const ny = handle.includes('n') ? ay - nh : handle.includes('s') ? ay : ay - nh / 2;
    return { x: nx, y: ny, width: nw, height: nh };
  }
  return { x: l, y: t, width: r - l, height: b - t };
}

/** Round-trip safe normalization (a full-canvas crop is "no crop"). */
export function normalizeCrop(r: CropRect): CropRect | null {
  return r.x <= 1e-6 && r.y <= 1e-6 && r.width >= 1 - 1e-6 && r.height >= 1 - 1e-6 ? null : r;
}

/**
 * Straighten: the user draws a line along something that should be horizontal
 * (or vertical). Returns the new `rotate` (degrees, clockwise positive) to add
 * to the current angle, in (-45, 45].
 */
export function straightenDelta(p0: { x: number; y: number }, p1: { x: number; y: number }): number {
  let a = (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI; // clockwise on screen (y down)
  while (a > 45) a -= 90;
  while (a <= -45) a += 90;
  return -a;
}
export const straightenAngle = (current: number, p0: { x: number; y: number }, p1: { x: number; y: number }): number => {
  const v = current + straightenDelta(p0, p1);
  return Math.max(-360, Math.min(360, Math.round(v * 100) / 100));
};

export type PerspectiveCorner = 'tl' | 'tr' | 'br' | 'bl';
/** Move a perspective corner offset by a normalized delta, clamped to ±0.5 (a corner never crosses the middle). */
export function movePerspectiveCorner(
  p: NonNullable<Geometry['perspective']> | null,
  corner: PerspectiveCorner,
  dx: number,
  dy: number,
): NonNullable<Geometry['perspective']> {
  const zero = { x: 0, y: 0 };
  const cur = p ?? { tl: zero, tr: zero, br: zero, bl: zero };
  const c = cur[corner];
  const clamp = (v: number) => Math.max(-0.5, Math.min(0.5, v));
  return { ...cur, [corner]: { x: clamp(c.x + dx), y: clamp(c.y + dy) } };
}
export const isZeroPerspective = (p: Geometry['perspective']): boolean => !p || (['tl', 'tr', 'br', 'bl'] as const).every((k) => p[k].x === 0 && p[k].y === 0);

/** Geometry with the largest auto-crop applied (keeping the requested aspect when given). */
export function withAutoCrop(g: Geometry, w0: number, h0: number, aspect?: number): Geometry {
  const c = autoCropRect({ ...g, crop: null }, w0, h0, aspect);
  return { ...g, crop: normalizeCrop(c) };
}

/** Gradient drag: from → to in normalized coordinates of the displayed canvas. */
export const gradientFromDrag = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ from: { x: a.x, y: a.y }, to: { x: b.x, y: b.y } });

/** Radial drag from the centre outwards: rx, ry are the normalized half-axes of the dragged box. */
export function radialFromDrag(center: { x: number; y: number }, edge: { x: number; y: number }, rotate = 0) {
  return { center: { x: center.x, y: center.y }, rx: Math.min(2, Math.abs(edge.x - center.x)), ry: Math.min(2, Math.abs(edge.y - center.y)), rotate };
}
