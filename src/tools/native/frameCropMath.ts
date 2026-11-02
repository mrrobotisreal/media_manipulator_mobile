/** Pure rectangle math for the crop editor. Rects are in SOURCE pixels (the video's display size). */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Corner = 'tl' | 'tr' | 'bl' | 'br';
export const MIN_CROP = 16;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * The video's display size. Phone clips carry a 90 degree rotation tag; ffmpeg auto-rotates before
 * `crop`, so coordinates are in the rotated frame. The decoded thumbnail is always oriented, so when its
 * orientation disagrees with the track size we swap the track size.
 */
export function displaySize(
  track: { width: number; height: number },
  thumb?: { width: number; height: number },
): { width: number; height: number } {
  if (!thumb || !thumb.width || !thumb.height) return track;
  const trackLandscape = track.width >= track.height;
  const thumbLandscape = thumb.width >= thumb.height;
  return trackLandscape === thumbLandscape ? track : { width: track.height, height: track.width };
}

/** Largest rect of `aspect` (w/h; null = free) centred in the source, at `fraction` of its size. */
export function initialRect(sw: number, sh: number, aspect: number | null, fraction = 0.8): Rect {
  let w = sw * fraction;
  let h = sh * fraction;
  if (aspect) {
    if (w / h > aspect) w = h * aspect;
    else h = w / aspect;
  }
  return { x: (sw - w) / 2, y: (sh - h) / 2, width: w, height: h };
}

export function moveRect(r: Rect, dx: number, dy: number, sw: number, sh: number): Rect {
  return {
    ...r,
    x: clamp(r.x + dx, 0, sw - r.width),
    y: clamp(r.y + dy, 0, sh - r.height),
  };
}

/** Drags one corner by (dx, dy) source pixels; the opposite corner stays put. */
export function resizeRect(
  r: Rect,
  corner: Corner,
  dx: number,
  dy: number,
  sw: number,
  sh: number,
  aspect: number | null,
): Rect {
  const left = corner === 'tl' || corner === 'bl';
  const top = corner === 'tl' || corner === 'tr';
  const ax = left ? r.x + r.width : r.x; // anchor (opposite corner)
  const ay = top ? r.y + r.height : r.y;
  let mx = clamp((left ? r.x : r.x + r.width) + dx, 0, sw);
  let my = clamp((top ? r.y : r.y + r.height) + dy, 0, sh);
  let w = Math.max(MIN_CROP, Math.abs(mx - ax));
  let h = Math.max(MIN_CROP, Math.abs(my - ay));
  if (aspect) {
    if (w / h > aspect) w = h * aspect;
    else h = w / aspect;
    const maxW = left ? ax : sw - ax;
    const maxH = top ? ay : sh - ay;
    if (w > maxW) {
      w = maxW;
      h = w / aspect;
    }
    if (h > maxH) {
      h = maxH;
      w = h * aspect;
    }
  } else {
    w = Math.min(w, left ? ax : sw - ax);
    h = Math.min(h, top ? ay : sh - ay);
  }
  mx = left ? ax - w : ax + w;
  my = top ? ay - h : ay + h;
  return { x: Math.min(ax, mx), y: Math.min(ay, my), width: w, height: h };
}

export const roundRect = (r: Rect): Rect => ({
  x: Math.round(r.x),
  y: Math.round(r.y),
  width: Math.round(r.width),
  height: Math.round(r.height),
});

/** Letterbox: the displayed image rect (contain) inside a container. */
export function containFit(sw: number, sh: number, cw: number, ch: number) {
  if (!(sw > 0) || !(sh > 0) || !(cw > 0) || !(ch > 0)) return { scale: 1, ox: 0, oy: 0 };
  const scale = Math.min(cw / sw, ch / sh);
  return { scale, ox: (cw - sw * scale) / 2, oy: (ch - sh * scale) / 2 };
}
