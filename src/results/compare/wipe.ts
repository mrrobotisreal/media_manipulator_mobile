/**
 * Pure math for the wipe handle. Port of web `lib/results/compare.ts` (@ 5e276a9): `clampWipe`,
 * `stepWipe`, `formatDelta`. RN additions: `wipeFromPointer` takes the view width and the layout
 * direction. All wipe values are LOGICAL percentages: 0 % is the START edge (left in LTR, right in
 * RTL), so the Original layer always grows from the start edge.
 */

export function clampWipe(value: number): number {
  if (Number.isNaN(value)) return 50;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

/** Accessibility-step for the wipe handle (`increment`/`decrement` actions): +-10 %. */
export function stepWipe(value: number, direction: 'increment' | 'decrement'): number {
  const current = clampWipe(value);
  return clampWipe(direction === 'increment' ? current + 10 : current - 10);
}

/**
 * Pointer x (physical, from the view's left edge) as a logical percentage. A zero-width (or
 * non-finite) view yields 50. In RTL the start edge is the right edge, so the value mirrors.
 */
export function wipeFromPointer(x: number, width: number, isRtl: boolean): number {
  if (!Number.isFinite(x) || !Number.isFinite(width) || width <= 0) return 50;
  const fromLeft = clampWipe((x / width) * 100);
  return isRtl ? 100 - fromLeft : fromLeft;
}

/** Physical left offset (px) of a logical percentage, for tests and gesture math. */
export function wipeToLeft(pct: number, width: number, isRtl: boolean): number {
  const p = clampWipe(pct);
  return ((isRtl ? 100 - p : p) / 100) * width;
}

/**
 * Signed percent change from `from` to `to` for the size stats ("−62%", "+12%", "0%").
 * Null when it is undefined (missing or zero baseline, non-finite input).
 */
export function formatDelta(from: number | undefined, to: number | undefined): string | null {
  if (
    from === undefined ||
    to === undefined ||
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from <= 0
  ) {
    return null;
  }
  const pct = Math.round(((to - from) / from) * 100);
  if (pct === 0) return '0%';
  return `${pct < 0 ? '−' : '+'}${Math.abs(pct)}%`;
}
