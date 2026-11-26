/**
 * The Darkroom caption preview on the phone (ticket MA62 decision 9): an APPROXIMATE preview,
 * labelled so ("Approximate preview"), never libass. The exact look is the server's ("Exact frame").
 *
 * What it takes from the web's caption model (copied, `src/studio/captions/`): the cue units
 * (`captionUnits`, the Go twin's word boundaries), the style sanitizer, the font fallback rule
 * (`captionFontFor`), uppercase (`captionUpper`), sentence ends and the catalog defaults. The ASS
 * generator's own resolution (`ass.ts` `resolve`, `cueTimedUnits`, `captionGroups`) is module-
 * private, so its rules are restated here line for line and pinned against the copied `.ass`
 * goldens (`__tests__/captionLayout.test.ts`: every Dialogue's start, end and active word must be
 * what this layout says at that time):
 * - timing in centiseconds (Go rounding), word times clamped non-decreasing into the cue, or the
 *   cue split evenly per unit when it has no word list;
 * - groups of `wordsPerGroup` units, broken early after a sentence end or a >= 150 ms pause;
 * - per-word animations show the group with the word whose span contains t active.
 *
 * Drawn per look (`captionDraw.ts`): box / word box / none background, outline, shadow, and the 10
 * animations approximated from the cue word timings: none, fade (in / out), pop / bounce (a scale
 * pulse of the active word), highlight (the active word recoloured), karaoke_fill (words fill as
 * spoken), word_by_word / typewriter (words revealed), box_highlight (a box behind the active
 * word), glow (the active word's outline in the highlight colour).
 *
 * Pure: no Skia; the draw module turns a `CaptionFrame` into paragraphs.
 */
import catalog from '../../../captions/captionsCatalog.json';
import { sanitizeCaptionStyle, sanitizeCaptionWords } from '../../../captions/sanitize';
import {
  captionFontByFamily,
  captionFontFor,
  captionSentenceEnd,
  captionUnits,
  captionUpper,
} from '../../../captions/units';
import type { StudioCaptionCue, StudioCaptionStyle } from '../../../studioTypes';

const D = catalog.defaults;

/** Go's math.Round (ass.ts `goRound`). */
const goRound = (x: number) => (x < 0 ? -Math.round(-x) : Math.sign(x) * Math.floor(Math.abs(x) + 0.5));
const centis = (sec: number) => goRound(Math.max(sec, 0) * 100);
const clampInt = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const intDiv = (a: number, b: number) => Math.trunc(a / b);

export type CaptionAnimation = (typeof catalog.animations)[number];

/** The style as the generator resolves it (ass.ts `resolve`), in project pixels. */
export interface CaptionLook {
  family: string;
  bold: boolean;
  uppercase: boolean;
  /** px at the project height. */
  fontSize: number;
  color: string;
  highlight: string;
  outlineColor: string;
  /** px at the project height. */
  outlinePx: number;
  shadowPx: number;
  backgroundColor: string;
  backgroundOpacity: number;
  bgMode: 'box' | 'none' | 'word_box';
  boxPad: number;
  animation: string;
  strength: number;
  wordsPerGroup: number;
  position: 'top' | 'middle' | 'bottom';
  maxWidthPct: number;
  /** ms */
  fadeIn: number;
  fadeOut: number;
  popScale: number;
}

export function resolveCaptionLook(style: StudioCaptionStyle | null | undefined, projectH: number): CaptionLook {
  const st = sanitizeCaptionStyle(style ?? null) ?? {
    fontSizePct: 4.5,
    color: '#FFFFFF',
    backgroundColor: '#000000',
    backgroundOpacity: 0.55,
    position: 'bottom' as const,
    maxWidthPct: 90,
  };
  const family = st.fontFamily || D.fontFamily;
  let bold = typeof st.bold === 'boolean' ? st.bold : D.bold;
  const f = captionFontByFamily(family);
  if (f && !f.bold) bold = false;
  const scale = projectH / 1080;
  let fontSize = goRound((projectH * st.fontSizePct) / 100);
  if (fontSize < 8) fontSize = 8;
  const strength = st.animationStrength ?? D.animationStrength;
  const fadeIn = goRound(120 + 180 * strength);
  return {
    family,
    bold,
    uppercase: st.uppercase === true,
    fontSize,
    color: st.color,
    highlight: st.highlightColor || D.highlightColor,
    outlineColor: st.outlineColor || D.outlineColor,
    outlinePx: (st.outlineWidth ?? D.outlineWidth) * scale,
    shadowPx: (st.shadow ?? D.shadow) * 8 * scale,
    backgroundColor: st.backgroundColor,
    backgroundOpacity: st.backgroundOpacity,
    bgMode: (st.backgroundMode || D.backgroundMode) as CaptionLook['bgMode'],
    boxPad: fontSize * 0.2,
    animation: st.animation || D.animation,
    strength,
    wordsPerGroup: st.wordsPerGroup ?? 0,
    position: st.position,
    maxWidthPct: st.maxWidthPct,
    fadeIn,
    fadeOut: goRound(fadeIn * 0.55),
    popScale: 100 + goRound(40 * strength),
  };
}

export interface TimedUnit {
  sep: string;
  text: string;
  /** centiseconds */
  start: number;
  end: number;
  emphasis: boolean;
}

/** ass.ts `cueTimedUnits` (sanitized words first, as `buildPreviewASS` does). */
export function cueTimedUnits(c0: StudioCaptionCue, uppercase: boolean): { units: TimedUnit[]; hasWords: boolean } {
  const words = sanitizeCaptionWords(c0);
  const c = words === c0.words ? c0 : { ...c0, words };
  const units = captionUnits(c.text);
  const cs = centis(c.startSeconds);
  let ce = centis(c.endSeconds);
  if (ce < cs) ce = cs;
  const n = units.length;
  const ws = c.words ?? [];
  const hasWords = ws.length === n && n > 0;
  let prev = cs;
  const out = units.map((u, i): TimedUnit => {
    const t: TimedUnit = { sep: u.sep, text: uppercase ? captionUpper(u.text) : u.text, start: 0, end: 0, emphasis: false };
    if (hasWords) {
      const w = ws[i]!;
      t.start = clampInt(centis(w.startSeconds), prev, ce);
      t.end = clampInt(centis(w.endSeconds), t.start, ce);
      t.emphasis = w.emphasis === true;
      prev = t.start;
    } else {
      t.start = cs + intDiv((ce - cs) * i, n);
      t.end = cs + intDiv((ce - cs) * (i + 1), n);
    }
    return t;
  });
  return { units: out, hasWords };
}

/** ass.ts `captionGroups`. */
export function captionGroups(units: TimedUnit[], perGroup: number, hasWords: boolean): [number, number][] {
  if (perGroup <= 0) return [[0, units.length]];
  const out: [number, number][] = [];
  let from = 0;
  for (let i = 0; i < units.length; i += 1) {
    if (i > from) {
      const brk =
        i - from >= perGroup ||
        captionSentenceEnd(units[i - 1]!.text) ||
        (hasWords && units[i]!.start - units[i - 1]!.end >= 15);
      if (brk) {
        out.push([from, i]);
        from = i;
      }
    }
  }
  out.push([from, units.length]);
  return out;
}

const PER_WORD = new Set(['highlight', 'pop', 'bounce', 'word_by_word', 'box_highlight', 'typewriter', 'glow']);

/** What is on screen at one instant. */
export interface CaptionFrame {
  cueId: string;
  family: string;
  /** The units of the visible group (`sep` = the whitespace before each). */
  words: TimedUnit[];
  /** Index of the active word in `words`, -1 for none. */
  active: number;
  /** The group's window (s), for fade in / out. */
  groupStart: number;
  groupEnd: number;
  /** Seconds into the active word (for pop / bounce / glow pulses), 0 when none. */
  intoActive: number;
  /** 0..1 progress through each word (karaoke fill, typewriter reveal). */
  progress: number[];
  /** Words not yet revealed (word_by_word, typewriter) are hidden. */
  revealed: boolean[];
}

/** The caption frame at timeline time `t` (s), or null when no cue shows. */
export function captionFrameAt(
  cues: readonly StudioCaptionCue[],
  look: CaptionLook,
  t: number,
): CaptionFrame | null {
  const tc = t * 100;
  for (const c of cues) {
    const cs = centis(c.startSeconds);
    const ce = centis(c.endSeconds);
    if (ce <= cs || tc < cs || tc >= ce) continue;
    const { units, hasWords } = cueTimedUnits(c, look.uppercase);
    if (units.length === 0) return null;
    const groups = captionGroups(units, look.wordsPerGroup, hasWords);
    for (let gi = 0; gi < groups.length; gi += 1) {
      const g = groups[gi]!;
      const gs = gi > 0 ? units[g[0]]!.start : cs;
      const ge = gi < groups.length - 1 ? units[groups[gi + 1]![0]]!.start : ce;
      if (ge <= gs || tc < gs || tc >= ge) continue;
      const gu = units.slice(g[0], g[1]);
      const wordBox = look.bgMode === 'word_box';
      const perWord = PER_WORD.has(look.animation) || (wordBox && look.animation === 'karaoke_fill');
      let active = -1;
      if (perWord) {
        for (let i = 0; i < gu.length; i += 1) {
          const s = i === 0 ? Math.max(gs, gu[0]!.start) : gu[i]!.start;
          const e = i + 1 < gu.length ? gu[i + 1]!.start : ge;
          if (e > s && tc >= s && tc < e) active = i;
        }
      }
      const revealing = look.animation === 'word_by_word' || look.animation === 'typewriter';
      // Revealing animations show nothing before the group's first word.
      if (revealing && perWord && active < 0) return null;
      const progress = gu.map((u) => (u.end > u.start ? Math.min(1, Math.max(0, (tc - u.start) / (u.end - u.start))) : tc >= u.start ? 1 : 0));
      const revealed = gu.map((_, i) => !revealing || i <= active);
      return {
        cueId: c.id,
        family: captionFontFor(look.family, c.text),
        words: gu,
        active,
        groupStart: gs / 100,
        groupEnd: ge / 100,
        intoActive: active >= 0 ? Math.max(0, tc - Math.max(gs, gu[active]!.start)) / 100 : 0,
        progress,
        revealed,
      };
    }
    return null;
  }
  return null;
}

/** The fade multiplier (`\fad(in,out)` on the group's window), 1 for other animations. */
export function captionFade(look: CaptionLook, f: CaptionFrame, t: number): number {
  if (look.animation !== 'fade') return 1;
  const dur = (f.groupEnd - f.groupStart) * 1000;
  let fin = look.fadeIn;
  let fout = look.fadeOut;
  if (fin + fout > dur) {
    const tot = fin + fout;
    fin = intDiv(fin * dur, tot);
    fout = intDiv(fout * dur, tot);
  }
  const ms = (t - f.groupStart) * 1000;
  const left = (f.groupEnd - t) * 1000;
  let a = 1;
  if (fin > 0 && ms < fin) a = Math.min(a, ms / fin);
  if (fout > 0 && left < fout) a = Math.min(a, left / fout);
  return Math.max(0, Math.min(1, a));
}

/** The active word's scale (pop: up then back over 180 ms; bounce: stretch, dip, settle over 260 ms). */
export function activeScale(look: CaptionLook, intoActiveS: number): [number, number] {
  const ms = intoActiveS * 1000;
  const lerp = (a: number, b: number, k: number) => a + (b - a) * Math.max(0, Math.min(1, k));
  if (look.animation === 'pop') {
    const s = look.popScale / 100;
    if (ms < 80) return [lerp(1, s, ms / 80), lerp(1, s, ms / 80)];
    if (ms < 180) return [lerp(s, 1, (ms - 80) / 100), lerp(s, 1, (ms - 80) / 100)];
    return [1, 1];
  }
  if (look.animation === 'bounce') {
    const k = look.strength;
    const bx = (100 + goRound(20 * k)) / 100;
    const by = (100 + goRound(45 * k)) / 100;
    const dx = (100 - goRound(6 * k)) / 100;
    const dy = (100 - goRound(10 * k)) / 100;
    if (ms < 90) return [lerp(1, bx, ms / 90), lerp(1, by, ms / 90)];
    if (ms < 180) return [lerp(bx, dx, (ms - 90) / 90), lerp(by, dy, (ms - 90) / 90)];
    if (ms < 260) return [lerp(dx, 1, (ms - 180) / 80), lerp(dy, 1, (ms - 180) / 80)];
    return [1, 1];
  }
  return [1, 1];
}

/** Every family a set of cues renders in (style family + per-cue script fallbacks). */
export function captionFamilies(cues: readonly StudioCaptionCue[], look: CaptionLook): string[] {
  const out = new Set([look.family]);
  for (const c of cues) out.add(captionFontFor(look.family, c.text));
  return [...out];
}
