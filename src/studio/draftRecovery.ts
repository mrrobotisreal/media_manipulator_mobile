// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/draftRecovery.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/**
 * draftRecovery — pure decision + presentation helpers for the crash-recovery
 * flow (part 08). The editor loads the server project, reads the local draft
 * (`draftStore.ts`), and asks this module what to do; nothing here touches
 * IndexedDB or React.
 */

import type { StudioProject } from './studioTypes';
import type { StudioDraft } from './mobile/drafts';

export type DraftDecision =
  /** No usable/newer draft — delete it and open normally. */
  | 'discard'
  /** Clean recovery: the draft is based on exactly the loaded server revision. */
  | 'recover'
  /**
   * The project was saved elsewhere after the draft was taken (base revision
   * differs from the server's): offer the conflict-dialog variant
   * (recover-and-take-over / discard) instead of silently applying it.
   */
  | 'conflict';

/**
 * Structural deep-equal that ignores object key order and treats keys holding
 * `undefined` as absent — the draft round-trips through IndexedDB's structured
 * clone while the server copy comes from a fresh Zod parse, so key order and
 * optional-field representation can differ without the documents differing.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isRecord(a) && isRecord(b)) {
    const keysA = Object.keys(a).filter((k) => a[k] !== undefined);
    const keysB = new Set(Object.keys(b).filter((k) => b[k] !== undefined));
    if (keysA.length !== keysB.size) return false;
    return keysA.every((k) => keysB.has(k) && deepEqual(a[k], b[k]));
  }
  return false;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * The user-editable slice of the document — everything a save request carries.
 * Server-authoritative metadata (revision, updatedAt, durationSeconds) is
 * excluded: it legitimately differs between a draft and a reloaded project.
 */
function editableSlice(p: StudioProject) {
  return {
    name: p.name,
    fps: p.fps,
    width: p.width,
    height: p.height,
    tracks: p.tracks,
    captions: p.captions,
    captionStyle: p.captionStyle,
    captionsEnabled: p.captionsEnabled,
    audio: p.audio,
    markers: p.markers,
  };
}

export function documentsEqual(a: StudioProject, b: StudioProject): boolean {
  return deepEqual(editableSlice(a), editableSlice(b));
}

/**
 * The recovery decision matrix (ticket 08):
 * - draft not newer than the server copy → discard (it can't contain anything
 *   the server doesn't already have; clocks are compared coarsely on purpose).
 * - documents identical → discard (nothing to recover).
 * - base revision differs from the server's (both known) → conflict variant.
 * - otherwise (same revision, or revisions unknown on either side — legacy
 *   backend) → clean recovery offer.
 */
export function evaluateDraft(draft: StudioDraft, server: StudioProject): DraftDecision {
  const serverUpdatedMs = Date.parse(server.updatedAt);
  if (Number.isFinite(serverUpdatedMs) && draft.savedAt <= serverUpdatedMs) return 'discard';
  if (documentsEqual(draft.document, server)) return 'discard';
  if (
    draft.baseRevision !== null &&
    typeof server.revision === 'number' &&
    draft.baseRevision !== server.revision
  ) {
    return 'conflict';
  }
  return 'recover';
}

// ---------------------------------------------------------------------------
// Coarse change summary for the recovery prompt
// ---------------------------------------------------------------------------

export interface DraftChangeSummary {
  tracksAdded: number;
  tracksRemoved: number;
  clipsAdded: number;
  clipsRemoved: number;
  /** Clips present in both documents whose contents differ. */
  clipsChanged: number;
  /** Caption cues, style, or enabled flag differ. */
  captionsChanged: boolean;
  /** Name / fps / resolution / audio config / markers differ. */
  otherChanges: boolean;
}

function clipsById(p: StudioProject): Map<string, unknown> {
  const m = new Map<string, unknown>();
  for (const track of p.tracks) for (const clip of track.clips) m.set(clip.id, clip);
  return m;
}

/**
 * Coarse tracks/clips deltas from the saved server document to the draft —
 * enough for a "2 clips added · 1 track removed" line, deliberately not a
 * field-level diff.
 */
export function summarizeDraftChanges(
  server: StudioProject,
  draft: StudioProject,
): DraftChangeSummary {
  const serverTrackIds = new Set(server.tracks.map((t) => t.id));
  const draftTrackIds = new Set(draft.tracks.map((t) => t.id));
  let tracksAdded = 0;
  let tracksRemoved = 0;
  for (const id of draftTrackIds) if (!serverTrackIds.has(id)) tracksAdded++;
  for (const id of serverTrackIds) if (!draftTrackIds.has(id)) tracksRemoved++;

  const serverClips = clipsById(server);
  const draftClips = clipsById(draft);
  let clipsAdded = 0;
  let clipsRemoved = 0;
  let clipsChanged = 0;
  for (const [id, clip] of draftClips) {
    const prev = serverClips.get(id);
    if (prev === undefined) clipsAdded++;
    else if (!deepEqual(prev, clip)) clipsChanged++;
  }
  for (const id of serverClips.keys()) if (!draftClips.has(id)) clipsRemoved++;

  const captionsChanged = !deepEqual(
    { cues: server.captions, style: server.captionStyle, enabled: server.captionsEnabled },
    { cues: draft.captions, style: draft.captionStyle, enabled: draft.captionsEnabled },
  );
  const otherChanges = !deepEqual(
    [server.name, server.fps, server.width, server.height, server.audio, server.markers],
    [draft.name, draft.fps, draft.width, draft.height, draft.audio, draft.markers],
  );

  return { tracksAdded, tracksRemoved, clipsAdded, clipsRemoved, clipsChanged, captionsChanged, otherChanges };
}

// ---------------------------------------------------------------------------
// Relative timestamp
// ---------------------------------------------------------------------------

/**
 * "2 minutes ago" / "yesterday"-style label for the recovery prompt. Uses the
 * browser locale; falls back to a plain clock string if Intl support is odd.
 */
export function formatRelativeTime(epochMs: number, now: number = Date.now()): string {
  const deltaSeconds = Math.round((epochMs - now) / 1000); // negative = past
  const abs = Math.abs(deltaSeconds);
  try {
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    if (abs < 60) return rtf.format(deltaSeconds, 'second');
    if (abs < 3600) return rtf.format(Math.round(deltaSeconds / 60), 'minute');
    if (abs < 86_400) return rtf.format(Math.round(deltaSeconds / 3600), 'hour');
    return rtf.format(Math.round(deltaSeconds / 86_400), 'day');
  } catch {
    return new Date(epochMs).toLocaleString();
  }
}
