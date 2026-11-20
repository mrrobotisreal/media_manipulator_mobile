// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/proTrim.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import type { StudioClip } from './studioTypes';
import { clipEnd } from './previewEngine';
import {
  clipSpeed,
  isFreezeClip,
  isReversed,
  sourceSpan,
  splitSourcePoint,
  trimPatch,
  MIN_SPEED_CLIP_SECONDS,
  type TrimSide,
} from './speed';

/**
 * Pro timeline trim math (Darkroom v3 part 18): roll, slip, slide and ripple
 * trims. Pure — no store, no DOM. Every planner takes one TRACK's clip list and
 * returns the new list (untouched clips keep their object identity) plus the
 * delta that was actually applied after clamping, so a gesture can feed the
 * live value back to the UI (slip's source-offset readout).
 *
 * All deltas are in TIMELINE seconds unless stated; every trim goes through
 * `trimPatch` (part 17), so speed and reverse are honored everywhere and the
 * result at 1x forward reduces to plain sourceIn/sourceOut arithmetic.
 *
 * `bound(clip)` is the clip's right-trim source bound (clipTrimBound): the
 * asset duration for media, Infinity for stills/titles (MM14).
 */

export type TrimBound = (clip: StudioClip) => number;

/** Edit points closer than this are "touching" (float slop from speed math). */
export const EDIT_EPS = 1e-3;

const BIG = 1e9;

/** The timeline-seconds delta a trimPatch result represents for `side`. */
function appliedDelta(orig: StudioClip, side: TrimSide, patch: Pick<StudioClip, 'sourceIn' | 'sourceOut' | 'timelineStart'>): number {
  if (side === 'l') return patch.timelineStart - orig.timelineStart;
  if (isFreezeClip(orig)) return patch.sourceOut - orig.sourceOut;
  const s = clipSpeed(orig);
  return isReversed(orig) ? (orig.sourceIn - patch.sourceIn) / s : (patch.sourceOut - orig.sourceOut) / s;
}

/** [min, max] timeline delta the given edge can move (negative = grow leftwards / shrink-from-right). */
export function trimDeltaRange(orig: StudioClip, side: TrimSide, bound: number): [number, number] {
  const lo = appliedDelta(orig, side, trimPatch(orig, side, -BIG, { assetDuration: bound }));
  const hi = appliedDelta(orig, side, trimPatch(orig, side, BIG, { assetDuration: bound }));
  return [lo, hi];
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function sortedByStart(clips: readonly StudioClip[]): StudioClip[] {
  return [...clips].sort((a, b) => a.timelineStart - b.timelineStart);
}

function replaceClips(clips: readonly StudioClip[], patches: Map<string, StudioClip>): StudioClip[] {
  return clips.map((c) => patches.get(c.id) ?? c);
}

export interface TrimPlan {
  clips: StudioClip[];
  /** The delta actually applied after clamping (timeline seconds, or source seconds for slip). */
  applied: number;
}

// --- Roll -------------------------------------------------------------------

/** The pair of clips sharing the edit point at `editTime` (A ends there, B starts there). */
export function findEditPair(
  clips: readonly StudioClip[],
  editTime: number,
): { a: StudioClip; b: StudioClip } | null {
  const sorted = sortedByStart(clips);
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const end = clipEnd(a);
    if (Math.abs(end - b.timelineStart) <= EDIT_EPS && Math.abs(end - editTime) <= EDIT_EPS) return { a, b };
  }
  return null;
}

/**
 * Roll the edit point at `editTime`: A's out-point and B's in-point move
 * together, so the pair's combined length never changes. Clamped by BOTH
 * sources (A can't run past its media, B can't start before its media's head)
 * and by the minimum clip length.
 */
export function planRoll(
  clips: readonly StudioClip[],
  editTime: number,
  delta: number,
  bound: TrimBound,
): TrimPlan | null {
  const pair = findEditPair(clips, editTime);
  if (!pair) return null;
  const { a, b } = pair;
  const [aLo, aHi] = trimDeltaRange(a, 'r', bound(a));
  const [bLo, bHi] = trimDeltaRange(b, 'l', bound(b));
  const lo = Math.max(aLo, bLo);
  const hi = Math.min(aHi, bHi);
  if (lo > hi) return null;
  const d = clamp(delta, lo, hi);
  if (d === 0) return { clips: [...clips], applied: 0 };
  const na: StudioClip = { ...a, ...trimPatch(a, 'r', d, { assetDuration: bound(a) }) };
  // B keeps its transition-free edge; its start moves with the edit.
  const nb: StudioClip = { ...b, ...trimPatch(b, 'l', d, { assetDuration: bound(b) }) };
  return { clips: replaceClips(clips, new Map([[a.id, na], [b.id, nb]])), applied: d };
}

// --- Slip -------------------------------------------------------------------

/** Clips that have a source range to re-window: not freeze, not stills, not titles. */
export function canSlip(clip: StudioClip, bound: number): boolean {
  return !clip.title && !isFreezeClip(clip) && Number.isFinite(bound) && bound > 0;
}

/**
 * Slip: shift the source window [sourceIn, sourceOut] by `deltaSource` source
 * seconds; position and duration are untouched. Clamped to [0, assetDuration].
 * Positive = later in the source. Returns null for clips with no source range
 * to slip on (stills, titles, freezes).
 */
export function planSlip(clip: StudioClip, deltaSource: number, bound: number): { clip: StudioClip; applied: number } | null {
  if (!canSlip(clip, bound)) return null;
  const span = sourceSpan(clip);
  const maxIn = Math.max(0, bound - span);
  const nextIn = clamp(clip.sourceIn + deltaSource, 0, maxIn);
  const applied = nextIn - clip.sourceIn;
  if (applied === 0) return { clip, applied: 0 };
  return { clip: { ...clip, sourceIn: nextIn, sourceOut: nextIn + span }, applied };
}

// --- Slide ------------------------------------------------------------------

/**
 * Slide: move the clip along the timeline while its TOUCHING neighbors absorb
 * the change — the previous clip's out-point and the next clip's in-point move
 * with it, so the track's total length is unchanged. A neighbor that is not
 * touching (a gap, or a transition overlap) does not absorb; the slide is then
 * bounded by the neighbor's edge instead (no overlap). The clip's own
 * duration/source never change. Clamped when a neighbor hits its minimum
 * length or runs out of source.
 */
export function planSlide(
  clips: readonly StudioClip[],
  clipId: string,
  delta: number,
  bound: TrimBound,
): TrimPlan | null {
  const sorted = sortedByStart(clips);
  const idx = sorted.findIndex((c) => c.id === clipId);
  if (idx < 0) return null;
  const c = sorted[idx];
  const prev = idx > 0 ? sorted[idx - 1] : undefined;
  const next = idx + 1 < sorted.length ? sorted[idx + 1] : undefined;
  const prevTouches = !!prev && Math.abs(clipEnd(prev) - c.timelineStart) <= EDIT_EPS;
  const nextTouches = !!next && Math.abs(clipEnd(c) - next.timelineStart) <= EDIT_EPS;

  let lo = -Infinity;
  let hi = Infinity;
  if (prev && prevTouches) {
    const [pLo, pHi] = trimDeltaRange(prev, 'r', bound(prev));
    lo = Math.max(lo, pLo);
    hi = Math.min(hi, pHi);
  } else {
    lo = Math.max(lo, -(c.timelineStart - (prev ? Math.min(clipEnd(prev), c.timelineStart) : 0)));
  }
  if (next && nextTouches) {
    const [nLo, nHi] = trimDeltaRange(next, 'l', bound(next));
    lo = Math.max(lo, nLo);
    hi = Math.min(hi, nHi);
  } else if (next) {
    hi = Math.min(hi, Math.max(0, next.timelineStart - clipEnd(c)));
  }
  if (lo > hi) return null;
  const d = clamp(delta, lo, hi);
  if (d === 0) return { clips: [...clips], applied: 0 };

  const patches = new Map<string, StudioClip>();
  patches.set(c.id, { ...c, timelineStart: Math.max(0, c.timelineStart + d) });
  if (prev && prevTouches) patches.set(prev.id, { ...prev, ...trimPatch(prev, 'r', d, { assetDuration: bound(prev) }) });
  if (next && nextTouches) patches.set(next.id, { ...next, ...trimPatch(next, 'l', d, { assetDuration: bound(next) }) });
  return { clips: replaceClips(clips, patches), applied: d };
}

// --- Ripple trim ------------------------------------------------------------

/**
 * Ripple trim of one clip edge by `delta` timeline seconds: the clip is
 * trimmed and every later clip on the track shifts by the length change so no
 * gap opens (or, when growing, nothing is overwritten). The clip itself keeps
 * its start position for a left trim (its head is shortened, the track closes
 * up), and its start for a right trim.
 */
export function planRippleTrim(
  clips: readonly StudioClip[],
  clipId: string,
  side: TrimSide,
  delta: number,
  bound: TrimBound,
): TrimPlan | null {
  const c = clips.find((x) => x.id === clipId);
  if (!c) return null;
  // A ripple head-trim keeps the clip where it is (the track closes up around
  // it), so growing the head is NOT bounded by the clip's distance from 0:
  // probe with the start pushed far right to defeat trimPatch's position clamp.
  const probe: StudioClip = side === 'l' ? { ...c, timelineStart: c.timelineStart + 1e6 } : c;
  const patch = trimPatch(probe, side, delta, { assetDuration: bound(c) });
  const applied = appliedDelta(probe, side, patch);
  if (applied === 0) return { clips: [...clips], applied: 0 };
  // Left: the clip stays put, later clips move by -applied. Right: by +applied.
  const shift = side === 'l' ? -applied : applied;
  const origEnd = clipEnd(c);
  const trimmed: StudioClip = { ...c, ...patch, timelineStart: c.timelineStart };
  const patches = new Map<string, StudioClip>([[c.id, trimmed]]);
  for (const o of clips) {
    if (o.id === c.id) continue;
    const later = side === 'l' ? o.timelineStart > c.timelineStart + EDIT_EPS : o.timelineStart >= origEnd - EDIT_EPS;
    if (later) patches.set(o.id, { ...o, timelineStart: Math.max(0, o.timelineStart + shift) });
  }
  return { clips: replaceClips(clips, patches), applied };
}

/**
 * Q / W: ripple-trim the previous ('prev') or next ('next') edit to the
 * playhead `t` on one track.
 *   - playhead inside a clip: 'prev' removes [clip start, t] from the clip's
 *     head, 'next' removes [t, clip end] from its tail; later clips close up.
 *   - playhead in a gap: 'prev' closes [gap start, t], 'next' closes [t, gap
 *     end] (only when a clip follows, otherwise there is nothing to ripple).
 * Returns null when nothing changes (no clip/gap at t, or t is on an edge).
 */
export function planRippleToPlayhead(
  clips: readonly StudioClip[],
  t: number,
  direction: 'prev' | 'next',
  bound: TrimBound,
): TrimPlan | null {
  const sorted = sortedByStart(clips);
  const inside = sorted.find((c) => t > c.timelineStart + EDIT_EPS && t < clipEnd(c) - EDIT_EPS);
  if (inside) {
    // A cut that would leave less than the minimum length is refused by trimPatch's clamp.
    return direction === 'prev'
      ? planRippleTrim(clips, inside.id, 'l', t - inside.timelineStart, bound)
      : planRippleTrim(clips, inside.id, 'r', t - clipEnd(inside), bound);
  }
  // In a gap (or on an edge adjacent to one).
  const before = [...sorted].reverse().find((c) => clipEnd(c) <= t + EDIT_EPS);
  const after = sorted.find((c) => c.timelineStart >= t - EDIT_EPS);
  const gapStart = before ? clipEnd(before) : 0;
  const gapEnd = after ? after.timelineStart : Infinity;
  if (!(t > gapStart + EDIT_EPS) && direction === 'prev') return null;
  if (!(t < gapEnd - EDIT_EPS) && direction === 'next') return null;
  if (!after) return null;
  const closeBy = direction === 'prev' ? t - gapStart : gapEnd - t;
  if (closeBy <= EDIT_EPS) return null;
  const patches = new Map<string, StudioClip>();
  for (const o of clips) {
    if (o.timelineStart >= gapEnd - EDIT_EPS) patches.set(o.id, { ...o, timelineStart: Math.max(0, o.timelineStart - closeBy) });
  }
  if (patches.size === 0) return null;
  return { clips: replaceClips(clips, patches), applied: closeBy };
}

/** Re-exported so callers can keep a gesture's source-offset readout in step with `splitSourcePoint`. */
export { splitSourcePoint, MIN_SPEED_CLIP_SECONDS };
