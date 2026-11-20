// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/timelineOps.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import type { StudioClip, StudioKeyframe, StudioTrack } from './studioTypes';
import { STUDIO_V3_RANGES } from './effectRegistry';
import { clipDuration, clipEnd } from './previewEngine';
import { splitSourcePoint } from './speed';
import {
  isEffectKeyframeProperty,
  pruneClipKeyframes,
  KEYFRAME_TIME_EPSILON,
  type NamedKeyframeProperty,
} from './keyframes';

/**
 * Pure timeline helpers shared by the Darkroom store (`lib/studioStore.ts`) and Medi's op
 * engine (`lib/assistant/ops/applyStudio.ts`, MM109). Moved verbatim out of the store so both
 * paths run the same placement, cut and keyframe rules; none of them touch store state.
 */

export const MIN_CLIP_SECONDS = 0.1;

export const clampRange = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export const uid = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(16)}`;
};

export function ensureBaseTracks(tracks: StudioTrack[]): StudioTrack[] {
  const out = [...tracks];
  if (!out.some((t) => t.kind === 'video')) {
    out.unshift({ id: uid(), kind: 'video', index: 0, muted: false, clips: [] });
  }
  if (!out.some((t) => t.kind === 'audio')) {
    out.push({ id: uid(), kind: 'audio', index: 0, muted: false, clips: [] });
  }
  return out;
}

// --- EDL v3 keyframe lane helpers (part 15) --------------------------------

// normalizeLane mirrors the Go sanitizer: t ≥ 0, value clamped to the
// property's range, sorted by t, deduped (same time → last wins), capped at 64.
export function normalizeLane(kfs: StudioKeyframe[], min: number, max: number): StudioKeyframe[] {
  const sorted = [...kfs]
    .map((k) => ({ t: Math.max(0, k.t), value: clampRange(k.value, min, max), ease: k.ease }))
    .sort((a, b) => a.t - b.t);
  const out: StudioKeyframe[] = [];
  for (const k of sorted) {
    if (out.length > 0 && Math.abs(out[out.length - 1].t - k.t) < KEYFRAME_TIME_EPSILON) {
      out[out.length - 1] = k;
    } else {
      out.push(k);
    }
  }
  return out.slice(0, STUDIO_V3_RANGES.keyframesPerProperty);
}

// writeKeyframeLane returns the clip with `property`'s lane replaced (undefined
// removes it). The v3 'volume' lane keeps the legacy `volumeKeyframes` mirror
// in sync (linear points, gain = value) so the timeline rubber band, pre-v3
// readers, and the export's legacy path all see the same automation — the same
// dual-write convention as transition/transitionInSeconds.
export function writeKeyframeLane(clip: StudioClip, property: string, lane: StudioKeyframe[] | undefined): StudioClip {
  const next = { ...(clip.keyframes ?? {}) };
  if (isEffectKeyframeProperty(property)) {
    const effects = { ...(next.effects ?? {}) };
    if (lane && lane.length > 0) effects[property] = lane;
    else delete effects[property];
    next.effects = effects;
  } else if (lane && lane.length > 0) {
    next[property as NamedKeyframeProperty] = lane;
  } else {
    delete next[property as NamedKeyframeProperty];
  }
  const out: StudioClip = { ...clip, keyframes: pruneClipKeyframes(next) };
  if (property === 'volume') {
    out.volumeKeyframes =
      lane && lane.length > 0 ? lane.map((k) => ({ t: k.t, gain: k.value })) : undefined;
  }
  return out;
}

// fitInGaps returns the start position nearest `desired` where a clip of length
// `dur` fits without overlapping any of `intervals` (the other clips on the
// track). It walks the free gaps (including the open-ended tail) and clamps
// `desired` into whichever gap minimizes the distance moved.
export function fitInGaps(
  intervals: { start: number; end: number }[],
  dur: number,
  desired: number,
): number {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const gaps: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const iv of sorted) {
    if (iv.start > cursor) gaps.push({ start: cursor, end: iv.start });
    cursor = Math.max(cursor, iv.end);
  }
  gaps.push({ start: cursor, end: Infinity });

  let best = cursor;
  let bestDist = Infinity;
  for (const g of gaps) {
    const maxStart = g.end === Infinity ? Infinity : g.end - dur;
    if (maxStart < g.start) continue; // gap too small
    const placed =
      maxStart === Infinity ? Math.max(desired, g.start) : Math.min(Math.max(desired, g.start), maxStart);
    const dist = Math.abs(placed - desired);
    if (dist < bestDist) {
      bestDist = dist;
      best = placed;
    }
  }
  return Math.max(0, best);
}

// placeInTrack positions the dragged clip within its track, reorder-aware.
// If the drop keeps the existing left-to-right order, the clip is placed at the
// nearest non-overlapping slot (gaps preserved). If the drop crosses a
// neighbour (the user wants a new order), the track is re-packed contiguously
// in the new order from the block's earliest start — so two clips can be freely
// swapped. Returns the new clips array for the track.
export function placeInTrack(clips: StudioClip[], draggedId: string, desiredStart: number): StudioClip[] {
  const dragged = clips.find((c) => c.id === draggedId);
  if (!dragged) return clips;
  const dur = clipDuration(dragged);
  const others = clips.filter((c) => c.id !== draggedId).sort((a, b) => a.timelineStart - b.timelineStart);

  const currentOrder = [...clips].sort((a, b) => a.timelineStart - b.timelineStart).map((c) => c.id);

  // Insertion index among the other clips, by the dragged clip's center.
  const center = Math.max(0, desiredStart) + dur / 2;
  let insertIdx = 0;
  for (const o of others) {
    if (o.timelineStart + clipDuration(o) / 2 < center) insertIdx += 1;
    else break;
  }
  const newOrder = [
    ...others.slice(0, insertIdx).map((c) => c.id),
    draggedId,
    ...others.slice(insertIdx).map((c) => c.id),
  ];

  if (newOrder.join() === currentOrder.join()) {
    // No reorder — reposition the dragged clip, preserving gaps.
    const placed = fitInGaps(
      others.map((c) => ({ start: c.timelineStart, end: clipEnd(c) })),
      dur,
      Math.max(0, desiredStart),
    );
    return clips.map((c) =>
      c.id === draggedId
        ? { ...c, timelineStart: placed, transition: undefined, transitionInSeconds: undefined }
        : c,
    );
  }

  // Reorder — re-pack contiguously from the block's earliest start. Positions
  // change, so any transitions (which depend on overlap) are cleared.
  const base = Math.max(0, Math.min(...clips.map((c) => c.timelineStart)));
  const byId = new Map(clips.map((c) => [c.id, c]));
  let cursor = base;
  return newOrder.map((id) => {
    const c = byId.get(id)!;
    const next = { ...c, timelineStart: cursor, transition: undefined, transitionInSeconds: undefined };
    cursor += clipDuration(c);
    return next;
  });
}

/**
 * Cut every eligible clip crossing `t` in two. The left half keeps the id; the
 * right half gets a fresh id, no entrance transition, and (when the original
 * was grouped) a NEW groupId shared by all right halves of that group — so a
 * grouped cut yields two groups. Non-crossing members of a split group that
 * start at/after `t` join the right-hand group. Speed-aware via
 * splitSourcePoint (part 17).
 */
export function cutTracksAt(
  tracks: StudioTrack[],
  t: number,
  eligible: (clip: StudioClip, track: StudioTrack) => boolean,
): { tracks: StudioTrack[]; cutIds: string[]; changed: boolean } {
  const cutIds: string[] = [];
  const newGroupOf = new Map<string, string>();
  let changed = false;
  const cutTracks = tracks.map((track) => {
    let trackChanged = false;
    const clips: StudioClip[] = [];
    for (const c of track.clips) {
      const crosses = t > c.timelineStart + MIN_CLIP_SECONDS && t < clipEnd(c) - MIN_CLIP_SECONDS;
      if (!(crosses && eligible(c, track))) {
        clips.push(c);
        continue;
      }
      trackChanged = true;
      const splitSource = splitSourcePoint(c, t);
      const reversed = c.reverse === true && !c.freeze;
      const left: StudioClip = reversed ? { ...c, sourceIn: splitSource } : { ...c, sourceOut: splitSource };
      let rightGroup = c.groupId;
      if (c.groupId) {
        if (!newGroupOf.has(c.groupId)) newGroupOf.set(c.groupId, uid());
        rightGroup = newGroupOf.get(c.groupId);
      }
      // The right piece starts flush against the left one — no overlap, so it
      // must not inherit the entrance transition.
      const right: StudioClip = {
        ...c,
        id: uid(),
        timelineStart: t,
        ...(reversed ? { sourceOut: splitSource } : { sourceIn: splitSource }),
        transition: undefined,
        transitionInSeconds: undefined,
        groupId: rightGroup,
      };
      clips.push(left, right);
      cutIds.push(left.id, right.id);
    }
    if (trackChanged) changed = true;
    return trackChanged ? { ...track, clips } : track;
  });
  if (!changed) return { tracks, cutIds, changed: false };
  if (newGroupOf.size === 0) return { tracks: cutTracks, cutIds, changed };
  // Pull the not-crossing members that sit after the cut into the right group.
  const cutSet = new Set(cutIds);
  const regrouped = cutTracks.map((track) => {
    let touched = false;
    const clips = track.clips.map((c) => {
      const ng = c.groupId ? newGroupOf.get(c.groupId) : undefined;
      if (ng && !cutSet.has(c.id) && c.timelineStart >= t - 1e-6) {
        touched = true;
        return { ...c, groupId: ng };
      }
      return c;
    });
    return touched ? { ...track, clips } : track;
  });
  return { tracks: regrouped, cutIds, changed };
}
