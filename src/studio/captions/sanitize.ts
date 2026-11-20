// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/captions/sanitize.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/**
 * Caption sanitizer (MM121) — the TS twin of SanitizeCaptionStyle / sanitizeCaptionWords in
 * media_manipulator_api/internal/models/studio_sanitize.go. The generator runs every style
 * through it first, exactly like BuildASS, so a hand-edited or stale style renders the same in
 * the preview and the export.
 */
import type { StudioCaptionCue, StudioCaptionStyle, StudioCaptionWord } from '../studioTypes';
import catalog from './captionsCatalog.json';
import { captionFontByFamily, captionUnits } from './units';

export const MAX_CAPTION_WORDS = 64;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const isHex = (s: unknown): s is string => typeof s === 'string' && /^#?[0-9a-fA-F]{6}$/.test(s.trim());
const normHex = (s: string) => '#' + s.trim().replace(/^#/, '').toUpperCase();
const LOOK_IDS = new Set(catalog.looks.map((l) => l.id));

/** Go's SanitizeCaptionStyle: clamps, defaults bad values, keeps MM121 fields only when valid. */
export function sanitizeCaptionStyle(st: StudioCaptionStyle | null | undefined): StudioCaptionStyle | null {
  if (!st) return null;
  const pos = st.position === 'top' || st.position === 'middle' ? st.position : 'bottom';
  const out: StudioCaptionStyle = {
    fontSizePct: clamp(st.fontSizePct > 0 ? st.fontSizePct : 4.5, 1, 15),
    color: isHex(st.color) ? normHex(st.color) : '#FFFFFF',
    backgroundColor: isHex(st.backgroundColor) ? normHex(st.backgroundColor) : '#000000',
    backgroundOpacity: clamp(st.backgroundOpacity ?? 0, 0, 1),
    position: pos,
    maxWidthPct: clamp(st.maxWidthPct > 0 ? st.maxWidthPct : 90, 40, 100),
  };
  if (st.fontFamily && captionFontByFamily(st.fontFamily)) out.fontFamily = st.fontFamily;
  if (typeof st.bold === 'boolean') out.bold = st.bold;
  if (typeof st.uppercase === 'boolean') out.uppercase = st.uppercase;
  if (isHex(st.highlightColor)) out.highlightColor = normHex(st.highlightColor);
  if (isHex(st.outlineColor)) out.outlineColor = normHex(st.outlineColor);
  if (typeof st.outlineWidth === 'number') out.outlineWidth = clamp(st.outlineWidth, 0, 12);
  if (typeof st.shadow === 'number') out.shadow = clamp(st.shadow, 0, 1);
  if (st.backgroundMode && catalog.backgroundModes.includes(st.backgroundMode)) out.backgroundMode = st.backgroundMode;
  if (typeof st.wordsPerGroup === 'number' && st.wordsPerGroup > 0) out.wordsPerGroup = Math.min(6, Math.trunc(st.wordsPerGroup));
  if (st.animation && catalog.animations.includes(st.animation)) out.animation = st.animation;
  if (typeof st.animationStrength === 'number') out.animationStrength = clamp(st.animationStrength, 0, 1);
  if (st.lookId && LOOK_IDS.has(st.lookId)) out.lookId = st.lookId;
  return out;
}

/** Go's sanitizeCaptionWords: one word per unit, non-empty, in the cue window, non-decreasing. */
export function sanitizeCaptionWords(c: StudioCaptionCue): StudioCaptionWord[] | undefined {
  const ws = c.words;
  if (!ws || ws.length === 0) return undefined;
  if (ws.length > MAX_CAPTION_WORDS || ws.length !== captionUnits(c.text).length) return undefined;
  const out: StudioCaptionWord[] = [];
  let prev = c.startSeconds;
  for (const w0 of ws) {
    const text = Array.from(w0.text.trim()).slice(0, 100).join('');
    if (text === '') return undefined;
    let start = clamp(w0.startSeconds, c.startSeconds, c.endSeconds);
    if (start < prev) start = prev;
    const end = clamp(w0.endSeconds, start, c.endSeconds);
    prev = start;
    const w: StudioCaptionWord = { text, startSeconds: start, endSeconds: end };
    if (w0.emphasis) w.emphasis = true;
    // MM122: the pre-retime Whisper times, kept only as a clamped pair.
    if (typeof w0.origStartSeconds === 'number' && typeof w0.origEndSeconds === 'number') {
      w.origStartSeconds = clamp(w0.origStartSeconds, c.startSeconds, c.endSeconds);
      w.origEndSeconds = clamp(w0.origEndSeconds, w.origStartSeconds, c.endSeconds);
    }
    out.push(w);
  }
  return out;
}
