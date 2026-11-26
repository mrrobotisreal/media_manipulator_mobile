// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/speed.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
'worklet'; // MA62: runs on the UI runtime (scripts/sync-studio.mjs WORKLET_FILES)
import type { StudioClip } from './studioTypes';
import { STUDIO_V3_RANGES } from './effectRegistry';

/**
 * Speed controls (Darkroom v3 part 17) — the pure source-time / duration math.
 * No DOM, no store. The Go side mirrors the duration rule in
 * models.ClipTimelineDuration and the export chains in studio_export.go.
 *
 * MODEL. A clip stores its SOURCE span [sourceIn, sourceOut] plus an optional
 * constant `speed` (1 = absent). Its TIMELINE duration is derived:
 *   (sourceOut - sourceIn) / speed.
 * Source-time mapping, with u = t - timelineStart (clip-local timeline time):
 *   forward : sourceIn  + u * speed
 *   reverse : sourceOut - u * speed
 *   freeze  : freeze.sourceTime (constant; duration is the raw span, speed n/a)
 * `reverse` is the DIRECTION of that same span; it never changes duration.
 */

/** Smallest clip a speed/duration edit may produce (matches the store's MIN_CLIP_SECONDS). */
export const MIN_SPEED_CLIP_SECONDS = 0.1;

/** Default length of an inserted freeze frame, seconds. */
export const DEFAULT_FREEZE_SECONDS = 2;

const EPS = 1e-9;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** True for a held-frame clip. */
export function isFreezeClip(c: StudioClip): boolean {
  return c.freeze !== undefined;
}

/** The clip's effective rate: 1 for absent speed, freeze clips and title clips. */
export function clipSpeed(c: StudioClip): number {
  if (c.freeze || c.title || c.speed === undefined) return 1;
  const r = STUDIO_V3_RANGES.speed;
  return clamp(c.speed, r.min, r.max);
}

/** Raw source span in seconds (>= 0). */
export function sourceSpan(c: StudioClip): number {
  return Math.max(0, c.sourceOut - c.sourceIn);
}

/** On-timeline duration: source span / speed (a freeze is its raw span). */
export function clipTimelineDuration(c: StudioClip): number {
  const span = sourceSpan(c);
  return span / clipSpeed(c);
}

/** Whether the clip plays its source backwards (never for freeze clips). */
export function isReversed(c: StudioClip): boolean {
  return c.reverse === true && !c.freeze;
}

/** The "Maintain audio pitch" toggle; default ON. */
export function maintainsPitch(c: StudioClip): boolean {
  return c.maintainPitch !== false;
}

/**
 * sourceTimeAt maps timeline time `t` to a position in the ORIGINAL source
 * media, clamped into [sourceIn, sourceOut] (the resolver may be asked a hair
 * past either end by frame rounding).
 */
export function sourceTimeAt(c: StudioClip, t: number): number {
  if (c.freeze) return c.freeze.sourceTime;
  const u = Math.max(0, t - c.timelineStart);
  const s = clipSpeed(c);
  if (c.reverse) return clamp(c.sourceOut - u * s, c.sourceIn, c.sourceOut);
  return clamp(c.sourceIn + u * s, c.sourceIn, c.sourceOut);
}

/**
 * reversedProxyTime converts an ORIGINAL-media position into the matching
 * position in the reversed proxy file (which is the original played backwards,
 * so its time axis is mirrored). Played FORWARD at `speed`, it traces exactly
 * `sourceTimeAt` of a reversed clip.
 */
export function reversedProxyTime(originalTime: number, assetDuration: number): number {
  if (!(assetDuration > 0)) return originalTime;
  return clamp(assetDuration - originalTime, 0, assetDuration);
}

/** Result of validating a requested speed against the track neighbourhood. */
export interface SpeedPlan {
  /** The speed that will actually be applied. */
  speed: number;
  /** True when `speed` differs from the request because of a clamp. */
  clamped: boolean;
  /** Why: the neighbour (slow-down would overlap it), the 0.1x–10x range, or the minimum clip length. */
  reason?: 'neighbor' | 'range' | 'minLength';
  /** Longest timeline duration the clip may take without overlapping the next clip (Infinity = unbounded). */
  maxDuration: number;
  /** Resulting timeline duration at `speed`. */
  duration: number;
}

/**
 * The start of the next clip on the same track strictly after `clip`'s start
 * (stable order), or undefined. `others` may include the clip itself.
 */
function nextStartAfter(others: StudioClip[], clip: StudioClip): number | undefined {
  let best: number | undefined;
  for (const o of others) {
    if (o.id === clip.id) continue;
    if (o.timelineStart <= clip.timelineStart + EPS) continue;
    if (best === undefined || o.timelineStart < best) best = o.timelineStart;
  }
  return best;
}

/**
 * planSpeed validates a requested constant speed for `clip` — NO RIPPLE: the
 * clip keeps its start; a speed-up leaves a gap, a slow-down grows rightwards
 * and is clamped so it never overlaps the next clip. A clip that ALREADY
 * overlaps its successor (a transition) may not grow further but is never
 * forced to shrink.
 */
export function planSpeed(trackClips: StudioClip[], clip: StudioClip, requested: number): SpeedPlan {
  const span = sourceSpan(clip);
  const range = STUDIO_V3_RANGES.speed;
  const current = clipTimelineDuration(clip);
  const nextStart = nextStartAfter(trackClips, clip);
  const room = nextStart === undefined ? Infinity : Math.max(nextStart - clip.timelineStart, current);

  let speed = Number.isFinite(requested) ? requested : 1;
  let reason: SpeedPlan['reason'];
  const inRange = clamp(speed, range.min, range.max);
  if (Math.abs(inRange - speed) > EPS) reason = 'range';
  speed = inRange;

  // Minimum clip length caps how fast a short span may go.
  if (span > 0) {
    const maxByLength = span / MIN_SPEED_CLIP_SECONDS;
    if (speed > maxByLength + EPS) {
      speed = Math.max(range.min, maxByLength);
      reason = 'minLength';
    }
  }
  // Neighbour cap: duration span/speed must fit in `room`.
  if (span > 0 && room !== Infinity && span / speed > room + EPS) {
    speed = Math.min(range.max, Math.max(range.min, span / room));
    reason = 'neighbor';
  }
  return {
    speed,
    clamped: reason !== undefined,
    reason,
    maxDuration: room,
    duration: span > 0 ? span / speed : 0,
  };
}

/**
 * planDuration back-solves a speed from a desired timeline duration
 * (Premiere-style: editing duration edits speed) and validates it like
 * `planSpeed`. Freeze clips are not retimed by speed: their duration IS the
 * span, bounded only by the next clip.
 */
export function planDuration(trackClips: StudioClip[], clip: StudioClip, desired: number): SpeedPlan {
  const span = sourceSpan(clip);
  const d = Math.max(MIN_SPEED_CLIP_SECONDS, Number.isFinite(desired) ? desired : span);
  return planSpeed(trackClips, clip, span > 0 ? span / d : 1);
}

/** Duration plan for a freeze clip: clamp to [min, room before the next clip]. */
export function planFreezeDuration(
  trackClips: StudioClip[],
  clip: StudioClip,
  desired: number,
): { duration: number; clamped: boolean; maxDuration: number } {
  const nextStart = nextStartAfter(trackClips, clip);
  const room = nextStart === undefined ? Infinity : Math.max(nextStart - clip.timelineStart, sourceSpan(clip));
  let d = Math.max(MIN_SPEED_CLIP_SECONDS, Number.isFinite(desired) ? desired : sourceSpan(clip));
  let clamped = false;
  if (d > room + EPS) {
    d = room;
    clamped = true;
  }
  return { duration: d, clamped, maxDuration: room };
}

/**
 * planFreezeInsert sizes a new freeze clip for the frame at the playhead: it
 * starts where `clip` ends and lasts DEFAULT_FREEZE_SECONDS, bounded by the
 * next clip. Returns null when there is no room (< the minimum clip length).
 */
export function planFreezeInsert(
  trackClips: StudioClip[],
  clip: StudioClip,
  playhead: number,
  want: number = DEFAULT_FREEZE_SECONDS,
): { timelineStart: number; duration: number; sourceTime: number; bounded: boolean } | null {
  const start = clip.timelineStart + clipTimelineDuration(clip);
  let next: number | undefined;
  for (const o of trackClips) {
    if (o.id === clip.id) continue;
    if (o.timelineStart < start - EPS) continue; // behind the end (or overlapped by a transition)
    if (next === undefined || o.timelineStart < next) next = o.timelineStart;
  }
  const room = next === undefined ? Infinity : next - start;
  const duration = Math.min(want, room);
  if (duration < MIN_SPEED_CLIP_SECONDS - EPS) return null;
  return {
    timelineStart: start,
    duration,
    sourceTime: sourceTimeAt(clip, playhead),
    bounded: duration < want - EPS,
  };
}

/** Which clip edge a trim gesture drags. */
export type TrimSide = 'l' | 'r';

export interface TrimLimits {
  /** Source seconds available past sourceOut (assetDuration for media, Infinity for stills/titles/freeze). */
  assetDuration: number;
}

/**
 * trimPatch converts a trim drag measured in TIMELINE seconds into the clip
 * patch, honoring speed and direction. `delta` > 0 moves the dragged edge
 * rightwards on the timeline. At 1x forward it reduces to the classic
 * sourceIn/sourceOut arithmetic. Returns the fields to merge.
 *
 *   left edge  (start): forward moves sourceIn, reversed moves sourceOut
 *   right edge (end)  : forward moves sourceOut, reversed moves sourceIn
 * each by delta * speed source-seconds, clamped so the clip keeps its minimum
 * length and stays within [0, assetDuration].
 */
export function trimPatch(
  orig: StudioClip,
  side: TrimSide,
  deltaTimeline: number,
  limits: TrimLimits,
): Pick<StudioClip, 'sourceIn' | 'sourceOut' | 'timelineStart'> {
  const s = clipSpeed(orig);
  const rev = isReversed(orig);
  const freeze = isFreezeClip(orig);
  const minSpan = MIN_SPEED_CLIP_SECONDS * s;
  const total = Number.isFinite(limits.assetDuration) ? limits.assetDuration : Infinity;

  if (freeze) {
    // A freeze has no source geometry to protect: its span IS its duration.
    if (side === 'l') {
      const d = clamp(deltaTimeline, -orig.timelineStart, sourceSpan(orig) - MIN_SPEED_CLIP_SECONDS);
      return { sourceIn: orig.sourceIn + d, sourceOut: orig.sourceOut, timelineStart: orig.timelineStart + d };
    }
    const d = Math.max(sourceSpan(orig) * -1 + MIN_SPEED_CLIP_SECONDS, deltaTimeline);
    return { sourceIn: orig.sourceIn, sourceOut: orig.sourceOut + d, timelineStart: orig.timelineStart };
  }

  if (side === 'l') {
    // Shrinking from the left (delta > 0) consumes source at the clip's start edge.
    const maxShrink = (sourceSpan(orig) - minSpan) / s;
    const maxGrow = rev
      ? Math.max(0, total - orig.sourceOut) / s
      : orig.sourceIn / s;
    const d = clamp(deltaTimeline, -Math.min(maxGrow, orig.timelineStart), maxShrink);
    return {
      sourceIn: rev ? orig.sourceIn : orig.sourceIn + d * s,
      sourceOut: rev ? orig.sourceOut - d * s : orig.sourceOut,
      timelineStart: orig.timelineStart + d,
    };
  }
  const maxShrink = (sourceSpan(orig) - minSpan) / s;
  const maxGrow = rev ? orig.sourceIn / s : Math.max(0, total - orig.sourceOut) / s;
  const d = clamp(deltaTimeline, -maxShrink, maxGrow);
  return {
    sourceIn: rev ? orig.sourceIn - d * s : orig.sourceIn,
    sourceOut: rev ? orig.sourceOut : orig.sourceOut + d * s,
    timelineStart: orig.timelineStart,
  };
}

/**
 * splitSourcePoint is the source position where a razor at timeline time `t`
 * cuts a clip, and which half keeps which source range:
 *   forward: left = [sourceIn, p], right = [p, sourceOut]
 *   reverse: left = [p, sourceOut], right = [sourceIn, p]   (left plays first, from the tail)
 */
export function splitSourcePoint(c: StudioClip, t: number): number {
  const u = t - c.timelineStart;
  const s = clipSpeed(c);
  return c.reverse && !c.freeze ? c.sourceOut - u * s : c.sourceIn + u * s;
}

/**
 * Whether an asset's reversed preview proxy is usable. `reversed` is the
 * client-side lifecycle (set when the job completes); a persisted
 * `s3KeyProxyReversed` (loaded with the asset list) counts too.
 */
export function reverseProxyReady(entry: {
  reversed?: 'processing' | 'ready' | 'failed';
  asset: { s3KeyProxyReversed?: string };
}): boolean {
  return entry.reversed === 'ready' || (!!entry.asset.s3KeyProxyReversed && entry.reversed !== 'processing');
}
