// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/captions/wordEdit.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/**
 * The per-word caption editor's pure rules (MM122 decision 3, Premium+ via Limits.CaptionWordEdit).
 *
 * - Retime: dragging the boundary between word i-1 and word i moves word i's start and word
 *   i-1's end together (one boundary, as the lane draws it); the first word's left edge and the
 *   last word's right edge move alone. The time is snapped to one frame of the project and
 *   clamped between the neighbouring boundaries (a word keeps at least one frame), and inside
 *   the cue. The first hand retime of a word stores Whisper's times in origStart/EndSeconds so
 *   "Re-time from audio" (resetCueTimes) restores them without a new AI job.
 * - Emphasis: a click toggles words[i].emphasis (colours the word for the whole cue).
 *
 * The store wraps a drag in beginGesture/endGesture, so a whole drag is one undo step.
 */
import type { StudioCaptionCue, StudioCaptionWord } from '../studioTypes';

/** One frame at the project rate (30 fps when unknown). */
export const frameSeconds = (fps: number | undefined) => 1 / (fps && fps > 0 ? fps : 30);

/** Snap a time to the nearest frame boundary of the timeline. */
export function snapToFrame(t: number, fps: number | undefined): number {
  const f = frameSeconds(fps);
  return Math.round(Math.round(t / f) * f * 1e6) / 1e6;
}

/** The boundary positions of a cue's words: boundary b sits before word b (b = n is the last end). */
export function wordBoundaries(cue: StudioCaptionCue): number[] {
  const ws = cue.words ?? [];
  if (ws.length === 0) return [];
  return [...ws.map((w) => w.startSeconds), ws[ws.length - 1].endSeconds];
}

function keepOrig(w: StudioCaptionWord): StudioCaptionWord {
  if (w.origStartSeconds !== undefined && w.origEndSeconds !== undefined) return w;
  return { ...w, origStartSeconds: w.startSeconds, origEndSeconds: w.endSeconds };
}

/**
 * The cue's words with boundary `b` (0..n) moved to `t` (snapped, clamped). Returns the words
 * unchanged (same array) when the cue has none or nothing moves.
 */
export function retimeBoundary(cue: StudioCaptionCue, b: number, t: number, fps: number | undefined): StudioCaptionWord[] | undefined {
  const ws = cue.words;
  if (!ws || ws.length === 0 || b < 0 || b > ws.length) return ws;
  const f = frameSeconds(fps);
  const bounds = wordBoundaries(cue);
  const lo = b === 0 ? cue.startSeconds : bounds[b - 1] + f;
  const hi = b === ws.length ? cue.endSeconds : bounds[b + 1] - f;
  if (hi < lo) return ws;
  const at = Math.min(hi, Math.max(lo, snapToFrame(t, fps)));
  if (Math.abs(at - bounds[b]) < 1e-9) return ws;
  return ws.map((w, i) => {
    if (i === b) return { ...keepOrig(w), startSeconds: at, endSeconds: Math.max(at, w.endSeconds) };
    if (i === b - 1) return { ...keepOrig(w), endSeconds: at };
    return w;
  });
}

/** The cue's words with word i's emphasis toggled. */
export function toggleEmphasis(cue: StudioCaptionCue, i: number): StudioCaptionWord[] | undefined {
  const ws = cue.words;
  if (!ws || i < 0 || i >= ws.length) return ws;
  return ws.map((w, j) => {
    if (j !== i) return w;
    if (w.emphasis) {
      const { emphasis: _e, ...rest } = w;
      void _e;
      return rest;
    }
    return { ...w, emphasis: true };
  });
}

/** True when any word of the cue was hand-retimed (it carries Whisper's original times). */
export function cueRetimed(cue: StudioCaptionCue): boolean {
  return (cue.words ?? []).some((w) => w.origStartSeconds !== undefined);
}

/**
 * "Re-time from audio": every hand-retimed word back to Whisper's stored times (no AI job).
 * Emphasis stays. Words never retimed keep theirs.
 */
export function resetCueTimes(cue: StudioCaptionCue): StudioCaptionWord[] | undefined {
  const ws = cue.words;
  if (!ws || !cueRetimed(cue)) return ws;
  return ws.map((w) => {
    if (w.origStartSeconds === undefined || w.origEndSeconds === undefined) return w;
    const { origStartSeconds: s, origEndSeconds: e, ...rest } = w;
    return { ...rest, startSeconds: s, endSeconds: e };
  });
}
