/** Pure math for the range track (shared by the trim scrubber and MA19's audio trim). Time runs left to right. */

export const DEFAULT_MIN_GAP = 0.1;

const finite = (n: number, fallback = 0) => (Number.isFinite(n) ? n : fallback);

export function timeToX(t: number, duration: number, width: number): number {
  if (!(duration > 0) || !(width > 0)) return 0;
  return Math.min(width, Math.max(0, (finite(t) / duration) * width));
}

export function xToTime(x: number, duration: number, width: number): number {
  if (!(duration > 0) || !(width > 0)) return 0;
  return Math.min(duration, Math.max(0, (finite(x) / width) * duration));
}

/** Rounds to the nearest `step` (default 0.1 s), clean of float noise. */
export function snap(t: number, step = 0.1): number {
  if (!(step > 0)) return t;
  return Math.round(Math.round(t / step) * step * 1e6) / 1e6;
}

/**
 * Keeps 0 <= start <= end <= duration with end - start >= minGap. `moved` says which side the user is
 * dragging so the other side holds still (the dragged side is the one that gives way).
 */
export function clampRange(
  start: number,
  end: number,
  duration: number,
  minGap = DEFAULT_MIN_GAP,
  moved: 'start' | 'end' = 'start',
): { start: number; end: number } {
  const d = Math.max(0, finite(duration));
  const gap = Math.min(minGap, d);
  let s = Math.min(Math.max(0, finite(start)), d);
  let e = Math.min(Math.max(0, finite(end, d)), d);
  if (e - s < gap) {
    if (moved === 'start') s = Math.max(0, e - gap);
    else e = Math.min(d, s + gap);
    if (e - s < gap) {
      // Pinned against a boundary: push the other side.
      if (moved === 'start') e = Math.min(d, s + gap);
      else s = Math.max(0, e - gap);
    }
  }
  return { start: s, end: e };
}

/** Moves the whole window by `delta` seconds, keeping its length and staying inside [0, duration]. */
export function shiftRange(
  start: number,
  end: number,
  delta: number,
  duration: number,
): { start: number; end: number } {
  const len = end - start;
  const s = Math.min(Math.max(0, start + delta), Math.max(0, duration - len));
  return { start: s, end: s + len };
}
