/**
 * Pure geometry for the face picker and the object-box drawer (MA20). Boxes are normalized [0,1]
 * to the ORIENTED image (the one the server measures). The image is shown `contain`-fitted inside a
 * canvas, so there are letterbox bars on one axis; these helpers map between the two spaces.
 */
export interface Size {
  width: number;
  height: number;
}
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface DisplayBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Smallest side of a drawn box, normalized (web `MIN_SIZE`). */
export const MIN_SIZE = 0.01;
/** Minimum touch target for a face / handle, in points. */
export const MIN_HIT = 44;

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** The rectangle the image occupies inside `layout` under `contentFit="contain"`. */
export function containRect(layout: Size, aspect: number): DisplayBox {
  if (layout.width <= 0 || layout.height <= 0 || !(aspect > 0)) {
    return {
      left: 0,
      top: 0,
      width: Math.max(0, layout.width),
      height: Math.max(0, layout.height),
    };
  }
  const layoutAspect = layout.width / layout.height;
  if (aspect > layoutAspect) {
    const height = layout.width / aspect;
    return { left: 0, top: (layout.height - height) / 2, width: layout.width, height };
  }
  const width = layout.height * aspect;
  return { left: (layout.width - width) / 2, top: 0, width, height: layout.height };
}

/** Normalized box -> canvas pixels. */
export function normToDisplay(box: Rect, layout: Size, aspect: number): DisplayBox {
  const img = containRect(layout, aspect);
  return {
    left: img.left + box.x * img.width,
    top: img.top + box.y * img.height,
    width: box.width * img.width,
    height: box.height * img.height,
  };
}

/** Canvas point -> normalized image point, clamped to the image. */
export function displayToNorm(
  point: { x: number; y: number },
  layout: Size,
  aspect: number,
): { x: number; y: number } {
  const img = containRect(layout, aspect);
  if (img.width <= 0 || img.height <= 0) return { x: 0, y: 0 };
  return {
    x: clamp01((point.x - img.left) / img.width),
    y: clamp01((point.y - img.top) / img.height),
  };
}

/** Keeps a rect inside [0,1] and at least MIN_SIZE per side. */
export function clampRect(r: Rect, min = MIN_SIZE): Rect {
  const width = Math.min(1, Math.max(min, r.width));
  const height = Math.min(1, Math.max(min, r.height));
  return {
    x: Math.min(1 - width, Math.max(0, r.x)),
    y: Math.min(1 - height, Math.max(0, r.y)),
    width,
    height,
  };
}

/** Rect spanned by two normalized points (drag from `a` to `b`, any direction). */
export function rectFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/** Moves a rect by a normalized delta, keeping its size and staying inside the image. */
export function moveRect(r: Rect, dx: number, dy: number): Rect {
  return {
    ...r,
    x: Math.min(1 - r.width, Math.max(0, r.x + dx)),
    y: Math.min(1 - r.height, Math.max(0, r.y + dy)),
  };
}

export type Corner = 'nw' | 'ne' | 'sw' | 'se';

/** Drags one corner by a normalized delta; the opposite corner stays put. */
export function resizeFromCorner(r: Rect, corner: Corner, dx: number, dy: number): Rect {
  let left = r.x;
  let top = r.y;
  let right = r.x + r.width;
  let bottom = r.y + r.height;
  if (corner === 'nw' || corner === 'sw') left += dx;
  else right += dx;
  if (corner === 'nw' || corner === 'ne') top += dy;
  else bottom += dy;
  left = clamp01(left);
  right = clamp01(right);
  top = clamp01(top);
  bottom = clamp01(bottom);
  const x = Math.min(left, right);
  const y = Math.min(top, bottom);
  return clampRect({ x, y, width: Math.abs(right - left), height: Math.abs(bottom - top) });
}

/** A box's hit area in canvas pixels: at least MIN_HIT on each side, centred on the box. */
export function hitArea(d: DisplayBox, min = MIN_HIT): DisplayBox {
  const width = Math.max(d.width, min);
  const height = Math.max(d.height, min);
  return {
    left: d.left - (width - d.width) / 2,
    top: d.top - (height - d.height) / 2,
    width,
    height,
  };
}

/** Index of the topmost rect containing a normalized point, or -1. */
export function rectAt(rects: readonly Rect[], p: { x: number; y: number }): number {
  for (let i = rects.length - 1; i >= 0; i--) {
    const r = rects[i]!;
    if (p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height) return i;
  }
  return -1;
}

/** Which corner handle (if any) of `r` is within `hit` canvas pixels of `point` (canvas space). */
export function cornerAt(
  r: Rect,
  point: { x: number; y: number },
  layout: Size,
  aspect: number,
  hit = MIN_HIT / 2,
): Corner | null {
  const d = normToDisplay(r, layout, aspect);
  const corners: [Corner, number, number][] = [
    ['nw', d.left, d.top],
    ['ne', d.left + d.width, d.top],
    ['sw', d.left, d.top + d.height],
    ['se', d.left + d.width, d.top + d.height],
  ];
  let best: Corner | null = null;
  let bestDist = Infinity;
  for (const [c, cx, cy] of corners) {
    const dist = Math.hypot(point.x - cx, point.y - cy);
    if (dist <= hit && dist < bestDist) {
      best = c;
      bestDist = dist;
    }
  }
  return best;
}
