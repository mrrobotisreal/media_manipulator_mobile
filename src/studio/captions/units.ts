// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/captions/units.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/**
 * Caption units and scripts (MM121) — the TS twin of
 * media_manipulator_api/internal/models/studio_caption_units.go, rune for rune. The golden .ass
 * fixtures (lib/studio/captions/goldens) hold the two in lockstep: change both or neither.
 *
 * A unit is what a word timing attaches to: spaced scripts split on whitespace; Han and kana split
 * per character (CJK punctuation sticks to the preceding unit, opening brackets to the following
 * one), so Whisper words for zh/ja spread by character count.
 */
import catalog from './captionsCatalog.json';

export interface CaptionUnit {
  /** Whitespace that preceded the unit ('' between CJK characters or at the start). */
  sep: string;
  text: string;
  cjk: boolean;
}

const SEPS = new Set([' ', '\t', '\n', '\r', '\f', '\v', '　']);
const OPENERS = '「『（【〈《〔［｛〖〘〚';
const TRAIL_PUNCT = "!\"#$%&')*+,-./:;<=>?@\\]^_`|}~…—–”’";

const cp = (ch: string) => ch.codePointAt(0)!;
const isOpen = (ch: string) => OPENERS.includes(ch);

function isCJKPunct(ch: string): boolean {
  if (isOpen(ch)) return false;
  const r = cp(ch);
  return (r >= 0x3001 && r <= 0x303f) || r === 0x30fb || (r >= 0xff01 && r <= 0xff0f) ||
    (r >= 0xff1a && r <= 0xff20) || (r >= 0xff3b && r <= 0xff40) || (r >= 0xff5b && r <= 0xff65);
}

function isCJK(ch: string): boolean {
  const r = cp(ch);
  return (r >= 0x3040 && r <= 0x30ff) || (r >= 0x31f0 && r <= 0x31ff) || (r >= 0x3400 && r <= 0x4dbf) ||
    (r >= 0x4e00 && r <= 0x9fff) || (r >= 0xf900 && r <= 0xfaff) || (r >= 0xff66 && r <= 0xff9f) ||
    (r >= 0x20000 && r <= 0x2fa1f);
}

/** Splits text into caption units (models.CaptionUnits). */
export function captionUnits(text: string): CaptionUnit[] {
  const out: CaptionUnit[] = [];
  let sep = '';
  let open = '';
  let cur = -1;
  const start = (s: string, cjk: boolean) => {
    out.push({ sep, text: open + s, cjk });
    cur = out.length - 1;
    sep = '';
    open = '';
  };
  for (const ch of text) {
    if (SEPS.has(ch)) {
      cur = -1;
      sep += ch;
    } else if (isOpen(ch)) {
      cur = -1;
      open += ch;
    } else if (isCJKPunct(ch)) {
      if (cur >= 0) out[cur].text += ch;
      else start(ch, true);
    } else if (isCJK(ch)) {
      start(ch, true);
    } else if (cur >= 0 && (!out[cur].cjk || TRAIL_PUNCT.includes(ch))) {
      out[cur].text += ch;
    } else {
      start(ch, false);
    }
  }
  if (open !== '') {
    if (out.length > 0) out[out.length - 1].text += open;
    else out.push({ sep, text: open, cjk: false });
  }
  return out;
}

/** True when a unit ends a sentence (closing quotes/brackets after the mark are ignored). */
export function captionSentenceEnd(text: string): boolean {
  let t = text;
  while (t.length > 0 && "\"'”’)]」』）".includes(t[t.length - 1])) t = t.slice(0, -1);
  if (t === '') return false;
  const chars = Array.from(t);
  return '.!?。！？…'.includes(chars[chars.length - 1]);
}

/** The caption script of a character ('' = Latin/common). Mirrors models.CaptionScriptOf. */
export function captionScriptOf(ch: string): string {
  const r = cp(ch);
  if ((r >= 0x0100 && r <= 0x024f) || (r >= 0x1e00 && r <= 0x1eff)) return 'latin_ext';
  if (r < 0x0370) return '';
  if ((r >= 0x0370 && r <= 0x03ff) || (r >= 0x1f00 && r <= 0x1fff)) return 'greek';
  if ((r >= 0x0400 && r <= 0x052f) || (r >= 0x1c80 && r <= 0x1c8f) || (r >= 0x2de0 && r <= 0x2dff) || (r >= 0xa640 && r <= 0xa69f)) return 'cyrillic';
  if ((r >= 0x0590 && r <= 0x05ff) || (r >= 0xfb1d && r <= 0xfb4f)) return 'hebrew';
  if ((r >= 0x0600 && r <= 0x06ff) || (r >= 0x0750 && r <= 0x077f) || (r >= 0x08a0 && r <= 0x08ff) || (r >= 0xfb50 && r <= 0xfdff) || (r >= 0xfe70 && r <= 0xfeff)) return 'arabic';
  if ((r >= 0x0900 && r <= 0x097f) || (r >= 0xa8e0 && r <= 0xa8ff)) return 'devanagari';
  if ((r >= 0x1100 && r <= 0x11ff) || (r >= 0x3130 && r <= 0x318f) || (r >= 0xa960 && r <= 0xa97f) || (r >= 0xac00 && r <= 0xd7ff)) return 'hangul';
  if ((r >= 0x3000 && r <= 0x30ff) || (r >= 0x31f0 && r <= 0x31ff) || (r >= 0x3400 && r <= 0x4dbf) || (r >= 0x4e00 && r <= 0x9fff) ||
    (r >= 0xf900 && r <= 0xfaff) || (r >= 0xff00 && r <= 0xffef) || (r >= 0x20000 && r <= 0x2fa1f)) return 'han';
  return '';
}

export interface CaptionFontEntry {
  family: string;
  regular: string;
  bold?: string;
  scripts: string[];
  category: string;
}

export const CAPTION_FONTS: readonly CaptionFontEntry[] = catalog.fonts;
const FONT_BY_FAMILY = new Map(CAPTION_FONTS.map((f) => [f.family, f]));

export function captionFontByFamily(family: string): CaptionFontEntry | undefined {
  return FONT_BY_FAMILY.get(family);
}

function covers(f: CaptionFontEntry, need: Set<string>): boolean {
  for (const s of need) if (!f.scripts.includes(s)) return false;
  return true;
}

/**
 * The family a cue renders in (models.CaptionFontFor): the style's family when it covers every
 * script in the text, else the first fallback covering them all, else the fallback of the
 * highest-priority script. A generator rule, so both renderers load the same file.
 */
export function captionFontFor(family: string, text: string): string {
  const need = new Set<string>();
  for (const ch of text) {
    const s = captionScriptOf(ch);
    if (s) need.add(s);
  }
  if (need.size === 0) return family;
  const f = FONT_BY_FAMILY.get(family);
  if (f && covers(f, need)) return family;
  for (const fb of catalog.fallbackFonts) {
    const ff = FONT_BY_FAMILY.get(fb);
    if (ff && covers(ff, need)) return fb;
  }
  for (const p of catalog.scriptPriority) if (need.has(p.script)) return p.family;
  return family;
}

// Runes whose full uppercase mapping is more than one character (SpecialCasing.txt) stay as
// they are, so this and Go's simple per-rune mapping agree (models.CaptionUpper).
const UPPER_SKIP = 'ßŉǰΐΰևẖẗẘẙẚὐὒὔὖﬀﬁﬂﬃﬄﬅﬆﬓﬔﬕﬖﬗ';

/** Uppercases caption text character by character (the `uppercase` style). */
export function captionUpper(s: string): string {
  let out = '';
  for (const ch of s) {
    const r = cp(ch);
    if ((r >= 0x1f80 && r <= 0x1fff) || UPPER_SKIP.includes(ch)) {
      out += ch;
      continue;
    }
    const u = ch.toUpperCase();
    out += Array.from(u).length === 1 ? u : ch;
  }
  return out;
}
