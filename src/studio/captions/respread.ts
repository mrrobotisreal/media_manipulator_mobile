// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/captions/respread.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/**
 * Re-spread word timings after a cue edit (MM121 decision 3). Pure; the API sanitizer accepts its
 * output unchanged (respread.test.ts round-trips it through the TS twin of the Go sanitizer).
 *
 * - Text edit: positional match (not text match, so a repeated word keeps its own time). The
 *   common prefix and suffix of old and new units keep their times; the changed middle shares
 *   the time between its neighbours by character count.
 * - Retime (start/end moved, text unchanged): times scale into the new window.
 * - A cue without words stays without (it animates on an even spread).
 */
import type { StudioCaptionCue, StudioCaptionWord } from '../studioTypes';
import { MAX_CAPTION_WORDS } from './sanitize';
import { captionUnits } from './units';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const charLen = (s: string) => Math.max(1, Array.from(s).length);

/** Even spread of a cue's units by character count (used for inserted runs). */
function spread(texts: string[], start: number, end: number): StudioCaptionWord[] {
  const total = texts.reduce((n, t) => n + charLen(t), 0);
  let acc = 0;
  return texts.map((text) => {
    const s = start + ((end - start) * acc) / total;
    acc += charLen(text);
    const e = start + ((end - start) * acc) / total;
    return { text, startSeconds: r3(s), endSeconds: r3(e) };
  });
}

/** Clamp into the cue window and make starts non-decreasing (the sanitizer's rule). */
function normalize(ws: StudioCaptionWord[], start: number, end: number): StudioCaptionWord[] {
  let prev = start;
  return ws.map((w) => {
    let s = Math.min(end, Math.max(start, w.startSeconds));
    if (s < prev) s = prev;
    const e = Math.min(end, Math.max(s, w.endSeconds));
    prev = s;
    const out: StudioCaptionWord = { text: w.text, startSeconds: s, endSeconds: e };
    if (w.emphasis) out.emphasis = true;
    if (w.origStartSeconds !== undefined && w.origEndSeconds !== undefined) {
      out.origStartSeconds = w.origStartSeconds;
      out.origEndSeconds = w.origEndSeconds;
    }
    return out;
  });
}

/**
 * The words for `next` given the cue before the edit. Returns undefined when the cue should
 * carry no words (none before, an empty text, or over the 64-word cap).
 */
export function respreadWords(prev: StudioCaptionCue, next: Pick<StudioCaptionCue, 'text' | 'startSeconds' | 'endSeconds'>): StudioCaptionWord[] | undefined {
  const old = prev.words;
  if (!old || old.length === 0) return undefined;
  const units = captionUnits(next.text).map((u) => u.text);
  if (units.length === 0 || units.length > MAX_CAPTION_WORDS) return undefined;
  const { startSeconds: ns, endSeconds: ne } = next;

  // Retime: scale the old times into the new window.
  let base = old;
  if (prev.startSeconds !== ns || prev.endSeconds !== ne) {
    const od = prev.endSeconds - prev.startSeconds;
    const k = od > 0 ? (ne - ns) / od : 0;
    base = old.map((w) => ({
      ...w,
      startSeconds: r3(ns + (w.startSeconds - prev.startSeconds) * k),
      endSeconds: r3(ns + (w.endSeconds - prev.startSeconds) * k),
    }));
  }
  const oldTexts = captionUnits(prev.text).map((u) => u.text);
  if (oldTexts.length !== base.length) {
    // Stale list (text changed elsewhere without a re-spread): even spread.
    return normalize(spread(units, ns, ne), ns, ne);
  }
  // Common prefix / suffix by position and text.
  let p = 0;
  while (p < units.length && p < oldTexts.length && units[p] === oldTexts[p]) p++;
  let q = 0;
  while (q < units.length - p && q < oldTexts.length - p && units[units.length - 1 - q] === oldTexts[oldTexts.length - 1 - q]) q++;
  const head = base.slice(0, p).map((w, i) => ({ ...w, text: units[i] }));
  const tail = base.slice(base.length - q).map((w, i) => ({ ...w, text: units[units.length - q + i] }));
  const midTexts = units.slice(p, units.length - q);
  const oldMid = base.slice(p, base.length - q);
  let mid: StudioCaptionWord[] = [];
  if (midTexts.length > 0) {
    if (oldMid.length === midTexts.length) {
      // Same count: each word replaced in place keeps its slot's time.
      mid = oldMid.map((w, i) => ({ text: midTexts[i], startSeconds: w.startSeconds, endSeconds: w.endSeconds }));
    } else {
      // Inserted/removed words share the gap between the neighbours by character count.
      const gs = oldMid.length > 0 ? oldMid[0].startSeconds : head.length > 0 ? head[head.length - 1].endSeconds : ns;
      const ge = oldMid.length > 0 ? oldMid[oldMid.length - 1].endSeconds : tail.length > 0 ? tail[0].startSeconds : ne;
      mid = spread(midTexts, gs, Math.max(gs, ge));
    }
  }
  return normalize([...head, ...mid, ...tail], ns, ne);
}

/** A cue after a patch, with words re-spread (the store's updateCaption and Medi use it). */
export function patchCueKeepingWords(prev: StudioCaptionCue, patch: Partial<StudioCaptionCue>): StudioCaptionCue {
  const merged = { ...prev, ...patch };
  if ('words' in patch) return merged;
  const words = respreadWords(prev, merged);
  if (words) return { ...merged, words };
  const { words: _drop, ...rest } = merged;
  void _drop;
  return rest;
}
