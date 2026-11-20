/**
 * The Darkroom "Cut" (phase 1) edits as pure `doc -> doc` recipes for `mutate()` (ticket MA61
 * decision 3). Each one is a port of the matching web store action (`lib/studioStore.ts`) and calls
 * the copied web ops (`timelineOps`, `speed`, `looks`, `previewEngine`, `effectRegistry`); no new
 * edit logic is written where the web has one. Every recipe returns the SAME doc when it changes
 * nothing, and touches only the clip / track it edits (the round-trip suite pins that).
 *
 *   mutate(store, 'Split', (doc, s) => splitAt(doc, s.playhead, s.selection))
 */
import { STUDIO_V3_RANGES } from '../effectRegistry';
import { lookById, isLookEffectId, withLook } from '../looks';
import { clipDuration, clipEnd } from '../previewEngine';
import { planSpeed, trimPatch, type TrimSide } from '../speed';
import type {
  StudioAsset,
  StudioClip,
  StudioProject,
  StudioTitleLayer,
  StudioTrack,
  StudioTransition,
} from '../studioTypes';
import {
  MIN_CLIP_SECONDS,
  clampRange,
  cutTracksAt,
  ensureBaseTracks,
  fitInGaps,
  placeInTrack,
  uid,
} from '../timelineOps';
import { clipTrimBound } from '../clipTrimBound';
import { trackAcceptsAsset } from '../trackRules';

/** The web's `MAX_VOLUME` (+6 dB, matches Zod + the Go clamp) and `DEFAULT_IMAGE_SECONDS`. */
export const MAX_VOLUME = 2;
export const DEFAULT_IMAGE_SECONDS = 5;

function locate(doc: StudioProject, clipId: string) {
  for (const track of doc.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { clip, track };
  }
  return null;
}

/** The web's `expandToGroups`: grouped clips edit together (part 18). */
export function expandToGroups(ids: readonly string[], doc: StudioProject): string[] {
  if (ids.length === 0) return [...ids];
  const want = new Set(ids);
  const groups = new Set<string>();
  for (const tr of doc.tracks)
    for (const c of tr.clips) if (want.has(c.id) && c.groupId) groups.add(c.groupId);
  if (groups.size === 0) return [...ids];
  const out = new Set(ids);
  for (const tr of doc.tracks)
    for (const c of tr.clips) if (c.groupId && groups.has(c.groupId)) out.add(c.id);
  return Array.from(out);
}

/** Applies `fn` to one clip; every other track and clip keeps its reference. */
export function updateClip(
  doc: StudioProject,
  clipId: string,
  fn: (c: StudioClip) => StudioClip,
): StudioProject {
  let changed = false;
  const tracks = doc.tracks.map((track) => {
    if (!track.clips.some((c) => c.id === clipId)) return track;
    const clips = track.clips.map((c) => {
      if (c.id !== clipId) return c;
      const next = fn(c);
      if (next !== c) changed = true;
      return next;
    });
    return changed ? { ...track, clips } : track;
  });
  return changed ? { ...doc, tracks } : doc;
}

/** The web's `updateClip(patch)`: merge, then keep in/out valid (min length, no negatives). */
export function patchClip(
  doc: StudioProject,
  clipId: string,
  patch: Partial<StudioClip>,
): StudioProject {
  return updateClip(doc, clipId, (c) => {
    const merged = { ...c, ...patch };
    if (merged.sourceIn < 0) merged.sourceIn = 0;
    if (merged.timelineStart < 0) merged.timelineStart = 0;
    if (merged.sourceOut < merged.sourceIn + MIN_CLIP_SECONDS)
      merged.sourceOut = merged.sourceIn + MIN_CLIP_SECONDS;
    return shallowSame(merged, c) ? c : merged;
  });
}

/** Shallow equality that treats a key holding `undefined` as absent (JSON drops both). */
function shallowSame(a: object, b: object): boolean {
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
  for (const k of keys) if (ra[k] !== rb[k]) return false;
  return true;
}

function withTrack(doc: StudioProject, track: StudioTrack): StudioProject {
  return { ...doc, tracks: doc.tracks.map((t) => (t.id === track.id ? track : t)) };
}

/**
 * Trim one edge by `deltaTimeline` seconds (the timeline drag; the web's `trimPatch` with the bin's
 * `clipTrimBound`, so speed, reverse, stills and titles are honoured).
 */
export function trimClip(
  doc: StudioProject,
  clipId: string,
  side: TrimSide,
  deltaTimeline: number,
  asset: Pick<StudioAsset, 'mediaKind' | 'durationSeconds'> | undefined,
): StudioProject {
  const found = locate(doc, clipId);
  if (!found) return doc;
  const bound = clipTrimBound(asset, !!found.clip.title);
  const patch = trimPatch(found.clip, side, deltaTimeline, { assetDuration: bound });
  return patchClip(doc, clipId, patch);
}

/** The web's `splitAtPlayhead`: cut the selected clips (and their groups), or every crossing one. */
export function splitAt(
  doc: StudioProject,
  t: number,
  selection: readonly string[] = [],
): StudioProject {
  const restrictTo = new Set(expandToGroups(selection, doc));
  const restrict = restrictTo.size > 0;
  const res = cutTracksAt(
    doc.tracks,
    t,
    (c, track) => !track.locked && (!restrict || restrictTo.has(c.id)),
  );
  return res.changed ? { ...doc, tracks: res.tracks } : doc;
}

/** The web's `moveClip`: nearest non-overlapping start on the same track (reorder-aware). */
export function moveClip(doc: StudioProject, clipId: string, desiredStart: number): StudioProject {
  const found = locate(doc, clipId);
  if (!found) return doc;
  const placed = placeInTrack(found.track.clips, clipId, desiredStart);
  // placeInTrack returns fresh clip objects; keep the old reference of every unchanged clip so a
  // drop in place is a no-op (no undo step) and untouched clips keep their identity.
  const clips = placed.map((c) => {
    const old = found.track.clips.find((o) => o.id === c.id);
    return old && shallowSame(old, c) ? old : c;
  });
  const same = clips.every((c, i) => c === found.track.clips[i]);
  return same ? doc : withTrack(doc, { ...found.track, clips });
}

/** The web's `moveClipToTrack`, refusing a track of the other kind (trackRules). */
export function moveClipToTrack(
  doc: StudioProject,
  clipId: string,
  targetTrackId: string,
  desiredStart: number,
  assetKind?: StudioAsset['mediaKind'],
): StudioProject {
  const found = locate(doc, clipId);
  const target = doc.tracks.find((t) => t.id === targetTrackId);
  if (!found || !target) return doc;
  if (found.track.id === targetTrackId) return moveClip(doc, clipId, desiredStart);
  if (found.clip.title ? target.kind !== 'video' : target.kind !== found.track.kind) return doc;
  if (assetKind && !found.clip.title && !trackAcceptsAsset(target.kind, assetKind)) return doc;
  const moving = { ...found.clip, timelineStart: Math.max(0, desiredStart) };
  const tracks = doc.tracks.map((track) => {
    if (track.id === found.track.id)
      return { ...track, clips: track.clips.filter((c) => c.id !== clipId) };
    if (track.id !== targetTrackId) return track;
    return { ...track, clips: placeInTrack([...track.clips, moving], clipId, desiredStart) };
  });
  return { ...doc, tracks };
}

/** The web's `deleteSelected`: ripple delete (kept clips shift left), locked tracks skipped. */
export function rippleDelete(doc: StudioProject, ids: readonly string[]): StudioProject {
  const sel = new Set(ids);
  if (sel.size === 0) return doc;
  let changed = false;
  const tracks = doc.tracks.map((track) => {
    const removed = track.clips.filter((c) => sel.has(c.id));
    if (removed.length === 0 || track.locked) return track;
    changed = true;
    const kept = track.clips
      .filter((c) => !sel.has(c.id))
      .map((c) => {
        const shift = removed.reduce(
          (acc, r) => (r.timelineStart < c.timelineStart ? acc + clipDuration(r) : acc),
          0,
        );
        return shift > 0 ? { ...c, timelineStart: Math.max(0, c.timelineStart - shift) } : c;
      });
    return { ...track, clips: kept };
  });
  return changed ? { ...doc, tracks } : doc;
}

/**
 * The web's speed target rule (`findSpeedTarget`): titles, stills and held frames carry no speed.
 * `planSpeed` clamps to the neighbour, the 0.1–10× range and the minimum length.
 */
export function setClipSpeed(
  doc: StudioProject,
  clipId: string,
  speed: number,
  assetKind?: StudioAsset['mediaKind'],
): StudioProject {
  const found = locate(doc, clipId);
  if (!found || found.clip.title || found.clip.freeze || assetKind === 'image') return doc;
  const plan = planSpeed(found.track.clips, found.clip, speed);
  return patchClip(doc, clipId, { speed: plan.speed === 1 ? undefined : plan.speed });
}

export function setClipReverse(
  doc: StudioProject,
  clipId: string,
  reverse: boolean,
  assetKind?: StudioAsset['mediaKind'],
): StudioProject {
  const found = locate(doc, clipId);
  if (!found || found.clip.title || found.clip.freeze || assetKind === 'image') return doc;
  return patchClip(doc, clipId, { reverse: reverse ? true : undefined });
}

/** The web's `setClipVolume`: 0..2 (flat volume; keyframes, when present, still override it). */
export function setClipVolume(doc: StudioProject, clipId: string, volume: number): StudioProject {
  return patchClip(doc, clipId, { volume: clampRange(volume, 0, MAX_VOLUME) });
}

export function setClipOpacity(doc: StudioProject, clipId: string, opacity: number): StudioProject {
  return patchClip(doc, clipId, { opacity: clampRange(opacity, 0, 1) });
}

/** The web's `applyLook` (one of the 12 looks, with intensity) and `clearLook`. */
export function applyLook(
  doc: StudioProject,
  clipId: string,
  lookId: string,
  intensity = 1,
): StudioProject {
  const look = lookById(lookId);
  if (!look) return doc;
  return updateClip(doc, clipId, (c) => withLook(c, look, intensity));
}

export function clearLook(doc: StudioProject, clipId: string): StudioProject {
  return updateClip(doc, clipId, (c) => {
    if (!(c.effects ?? []).some((e) => isLookEffectId(e.id))) return c;
    const effects = (c.effects ?? []).filter((e) => !isLookEffectId(e.id));
    return { ...c, effects: effects.length ? effects : undefined };
  });
}

/**
 * The web's `setClipTransition`: a typed transition from the previous clip on the track (the clip
 * is pulled under its predecessor by the duration); `null` removes it and butts the clip up again.
 */
export function setClipTransition(
  doc: StudioProject,
  clipId: string,
  transition: StudioTransition | null,
): StudioProject {
  const found = locate(doc, clipId);
  if (!found) return doc;
  const { clip, track } = found;
  const prev = track.clips
    .filter((c) => c.id !== clipId && c.timelineStart < clip.timelineStart)
    .sort((a, b) => b.timelineStart - a.timelineStart)[0];
  if (!prev) return doc; // nothing before it to transition from
  const range = STUDIO_V3_RANGES.transitionDurationSeconds;
  const prevEnd = clipEnd(prev);
  const maxD = Math.min(clipDuration(prev), clipDuration(clip), range.max);
  return updateClip(doc, clipId, (c) => {
    if (!transition)
      return {
        ...c,
        timelineStart: prevEnd,
        transition: undefined,
        transitionInSeconds: undefined,
      };
    const d = clampRange(transition.durationSeconds, range.min, maxD);
    return {
      ...c,
      timelineStart: Math.max(0, prevEnd - d),
      transition: { ...transition, durationSeconds: d },
      transitionInSeconds: d,
    };
  });
}

/** The web's `updateTitleLayer` (title text, font, colour, position of one layer). */
export function updateTitleLayer(
  doc: StudioProject,
  clipId: string,
  index: number,
  patch: Record<string, unknown>,
): StudioProject {
  return updateClip(doc, clipId, (c) => {
    const layer = c.title?.layers[index];
    if (!c.title || !layer) return c;
    const merged = { ...layer, ...patch } as StudioTitleLayer;
    return {
      ...c,
      title: { ...c.title, layers: c.title.layers.map((l, i) => (i === index ? merged : l)) },
    };
  });
}

/** Title text: the first text layer's `text` (phase 1's title sheet). */
export function setTitleText(doc: StudioProject, clipId: string, text: string): StudioProject {
  const found = locate(doc, clipId);
  const index = found?.clip.title?.layers.findIndex((l) => l.type === 'text') ?? -1;
  if (index < 0) return doc;
  return updateTitleLayer(doc, clipId, index, { text });
}

/**
 * The web's `addClipFromAsset`: append on the first unlocked track of the asset's kind (a still
 * fits into the first gap, 5 s). Returns the doc and the new clip id (null when nothing placed).
 */
export function addClipFromAsset(
  doc: StudioProject,
  asset: Pick<StudioAsset, 'id' | 'mediaKind' | 'durationSeconds' | 'hasAudio'>,
  newId: () => string = uid,
): { doc: StudioProject; clipId: string | null } {
  if (asset.mediaKind === 'lut') return { doc, clipId: null }; // LUTs are graded, not placed
  const kind = asset.mediaKind === 'audio' ? 'audio' : 'video';
  const isImage = asset.mediaKind === 'image';
  const duration = isImage
    ? DEFAULT_IMAGE_SECONDS
    : asset.durationSeconds > 0
      ? asset.durationSeconds
      : 5;
  const tracks = ensureBaseTracks(doc.tracks);
  const clipId = newId();
  let placed = false;
  const next = tracks.map((track) => {
    if (placed || track.kind !== kind || track.locked) return track;
    placed = true;
    const startAt = isImage
      ? fitInGaps(
          track.clips.map((c) => ({ start: c.timelineStart, end: clipEnd(c) })),
          duration,
          0,
        )
      : track.clips.reduce((max, c) => Math.max(max, clipEnd(c)), 0);
    const clip: StudioClip = {
      id: clipId,
      assetId: asset.id,
      streamIndex: 0,
      timelineStart: startAt,
      sourceIn: 0,
      sourceOut: duration,
      volume: !isImage && asset.hasAudio ? 1 : undefined,
    };
    return { ...track, clips: [...track.clips, clip] };
  });
  return placed ? { doc: { ...doc, tracks: next }, clipId } : { doc, clipId: null };
}
