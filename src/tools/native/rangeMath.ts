/** Pure math for the trim range track (shared by the audio and video trim editors). */

export const DEFAULT_MIN_GAP = 0.1;

export function timeToX(t: number, duration: number, width: number): number {
  if (!(duration > 0) || !(width > 0) || !Number.isFinite(t)) return 0;
  return (Math.min(duration, Math.max(0, t)) / duration) * width;
}

export function xToTime(x: number, duration: number, width: number): number {
  if (!(duration > 0) || !(width > 0) || !Number.isFinite(x)) return 0;
  return (Math.min(width, Math.max(0, x)) / width) * duration;
}

export function snap(t: number, step = 0.1): number {
  if (!(step > 0)) return t;
  return Math.round(t / step) * step;
}

const r2 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Keeps 0 <= start, end <= duration and end - start >= minGap. `moved` says which handle the
 * user dragged, so the other one stays put when the gap would be violated.
 */
export function clampRange(
  start: number,
  end: number,
  duration: number,
  minGap = DEFAULT_MIN_GAP,
  moved: 'start' | 'end' = 'start',
): { start: number; end: number } {
  const d = Math.max(0, duration);
  const gap = Math.min(minGap, d);
  let s = Math.min(d, Math.max(0, start));
  let e = Math.min(d, Math.max(0, end));
  if (e - s < gap) {
    if (moved === 'start') s = Math.max(0, e - gap);
    else e = Math.min(d, s + gap);
    if (e - s < gap) {
      s = Math.max(0, e - gap);
      e = Math.min(d, s + gap);
    }
  }
  return { start: r2(s), end: r2(e) };
}
