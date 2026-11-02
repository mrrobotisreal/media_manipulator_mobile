import type { PixelRect } from '../options/image';

/**
 * Pure crop geometry (worklet-safe: every function is plain arithmetic). Two coordinate spaces: the
 * display rect lives inside the contained image box (origin = box top-left), the source rect in
 * EXIF-oriented source pixels. All resize/move functions work in whichever space `bounds` is in.
 */
export type Rect = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };
export type Corner = 'tl' | 'tr' | 'bl' | 'br';

/** Minimum crop side in source pixels (ticket decision 7). */
export const MIN_SOURCE_PX = 16;
export const ASPECTS = {
  '1:1': 1,
  '4:3': 4 / 3,
  '3:4': 3 / 4,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
} as const;
export type AspectKey = 'free' | keyof typeof ASPECTS;
export const aspectValue = (key: AspectKey): number | null =>
  key === 'free' ? null : ASPECTS[key];

/** `contentFit="contain"`: the displayed image box inside a container, plus display px per source px. */
export function containBox(container: Size, source: Size): Rect & { scale: number } {
  'worklet';
  if (source.width <= 0 || source.height <= 0 || container.width <= 0 || container.height <= 0)
    return { x: 0, y: 0, width: 0, height: 0, scale: 1 };
  const scale = Math.min(container.width / source.width, container.height / source.height);
  const width = source.width * scale;
  const height = source.height * scale;
  return {
    x: (container.width - width) / 2,
    y: (container.height - height) / 2,
    width,
    height,
    scale,
  };
}

const clamp = (v: number, lo: number, hi: number) => {
  'worklet';
  return Math.min(hi, Math.max(lo, v));
};

/** Keeps a rect inside `bounds` with each side at least `min` (the rect is shrunk first, then shifted). */
export function clampRect(rect: Rect, bounds: Size, min: number): Rect {
  'worklet';
  const m = Math.min(min, bounds.width, bounds.height);
  const width = clamp(rect.width, m, bounds.width);
  const height = clamp(rect.height, m, bounds.height);
  return {
    x: clamp(rect.x, 0, bounds.width - width),
    y: clamp(rect.y, 0, bounds.height - height),
    width,
    height,
  };
}

/** Moves a rect by (dx, dy), stopping at the bounds. */
export function moveRect(rect: Rect, dx: number, dy: number, bounds: Size): Rect {
  'worklet';
  return {
    ...rect,
    x: clamp(rect.x + dx, 0, bounds.width - rect.width),
    y: clamp(rect.y + dy, 0, bounds.height - rect.height),
  };
}

/** Fits `rect` to `aspect` (width / height) about its centre, then clamps. `null` leaves it free. */
export function applyAspect(rect: Rect, aspect: number | null, bounds: Size, min: number): Rect {
  'worklet';
  if (!aspect) return clampRect(rect, bounds, min);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  // Largest rect of this aspect whose area is no bigger than the current one's bounding box.
  let width = rect.width;
  let height = width / aspect;
  if (height > rect.height) {
    height = rect.height;
    width = height * aspect;
  }
  // Fit inside the bounds.
  const k = Math.min(1, bounds.width / width, bounds.height / height);
  width *= k;
  height *= k;
  // Honour the minimum on the shorter side without leaving the bounds.
  const short = Math.min(width, height);
  const m = Math.min(min, bounds.width, bounds.height);
  if (short < m) {
    const up = m / short;
    width *= up;
    height *= up;
    const down = Math.min(1, bounds.width / width, bounds.height / height);
    width *= down;
    height *= down;
  }
  return clampRect({ x: cx - width / 2, y: cy - height / 2, width, height }, bounds, 1);
}

/** Drags one corner by (dx, dy) from `start`; the opposite corner is the anchor. Aspect-locked when set. */
export function resizeCorner(
  start: Rect,
  corner: Corner,
  dx: number,
  dy: number,
  bounds: Size,
  min: number,
  aspect: number | null,
): Rect {
  'worklet';
  const right = corner === 'tr' || corner === 'br';
  const bottom = corner === 'bl' || corner === 'br';
  const ax = right ? start.x : start.x + start.width;
  const ay = bottom ? start.y : start.y + start.height;
  const px = (right ? start.x + start.width : start.x) + dx;
  const py = (bottom ? start.y + start.height : start.y) + dy;
  const maxW = right ? bounds.width - ax : ax;
  const maxH = bottom ? bounds.height - ay : ay;
  const m = Math.min(min, bounds.width, bounds.height);
  let width = clamp(right ? px - ax : ax - px, m, Math.max(m, maxW));
  let height = clamp(bottom ? py - ay : ay - py, m, Math.max(m, maxH));
  if (aspect) {
    // The axis the finger moved further (relative to the aspect) drives.
    if (width / aspect >= height) height = width / aspect;
    else width = height * aspect;
    const k = Math.min(1, maxW / width, maxH / height);
    width *= k;
    height *= k;
    const up = Math.max(1, m / width, m / height);
    width = Math.min(maxW, width * up);
    height = Math.min(maxH, height * up);
  }
  return { x: right ? ax : ax - width, y: bottom ? ay : ay - height, width, height };
}

/** Centred rect covering `fraction` of the image (default 80 %), honouring `aspect`. */
export function centredRect(source: Size, aspect: number | null, fraction = 0.8): Rect {
  'worklet';
  const base: Rect = {
    x: (source.width * (1 - fraction)) / 2,
    y: (source.height * (1 - fraction)) / 2,
    width: source.width * fraction,
    height: source.height * fraction,
  };
  return applyAspect(base, aspect, source, 1);
}

/** Display rect (origin = image box) to integer source pixels, clamped inside the source. */
export function displayToSource(rect: Rect, scale: number, source: Size): PixelRect {
  'worklet';
  if (scale <= 0) return { x: 0, y: 0, width: 1, height: 1 };
  const x = clamp(Math.round(rect.x / scale), 0, Math.max(0, source.width - 1));
  const y = clamp(Math.round(rect.y / scale), 0, Math.max(0, source.height - 1));
  const width = clamp(Math.round(rect.width / scale), 1, source.width - x);
  const height = clamp(Math.round(rect.height / scale), 1, source.height - y);
  return { x, y, width, height };
}

export function sourceToDisplay(rect: Rect, scale: number): Rect {
  'worklet';
  return {
    x: rect.x * scale,
    y: rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}
