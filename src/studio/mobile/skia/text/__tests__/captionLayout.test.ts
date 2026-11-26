/**
 * The approximate caption preview's layout (MA62 S4, decision 9) against the copied ASS goldens
 * (`src/studio/captions/goldens/*.json` + `.ass`, which the web and the Go generator reproduce byte
 * for byte). For every Dialogue of the Default style the golden emits, at its midpoint: the phone
 * shows a cue (none outside every Dialogue), the same group of words, and (for per-word animations)
 * the active word the Dialogue highlights. This pins the timing and grouping rules restated from
 * the generator; the look (outline, shadow, animation curves) is an approximation, visual only.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPreviewASS } from '../../../../captions/ass';
import { captionUnits } from '../../../../captions/units';
import type { StudioCaptionCue, StudioCaptionStyle } from '../../../../studioTypes';
import { activeScale, captionFade, captionFrameAt, resolveCaptionLook } from '../captionLayout';

const DIR = join(__dirname, '..', '..', '..', '..', 'captions', 'goldens');
const goldens = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as {
    name: string;
    width: number;
    height: number;
    style: StudioCaptionStyle | null;
    cues: StudioCaptionCue[];
  });

const ts = (s: string) => {
  const [h, m, rest] = s.split(':');
  return Number(h) * 3600 + Number(m) * 60 + Number(rest);
};
/** Strips override blocks: what the Dialogue shows. */
const plain = (text: string) => text.replace(/\{[^}]*\}/g, '').replace(/\\N/g, '\n');

interface Dialogue {
  start: number;
  end: number;
  text: string;
}
function dialogues(ass: string): Dialogue[] {
  return ass
    .split('\n')
    .filter((l) => l.startsWith('Dialogue: 1,'))
    .map((l) => {
      const parts = l.split(',');
      return { start: ts(parts[1]!), end: ts(parts[2]!), text: parts.slice(9).join(',') };
    });
}

it('the goldens are there', () => {
  expect(goldens.length).toBeGreaterThanOrEqual(20);
});

describe.each(goldens.map((g) => [g.name, g] as const))('%s', (_name, g) => {
  const ass = buildPreviewASS(g.cues, g.style, g.width, g.height);
  // The copied generator still matches its golden (so the test reads the real Dialogue list).
  it('the copied generator reproduces the golden', () => {
    expect(ass).toBe(readFileSync(join(DIR, `${g.name}.ass`), 'utf8'));
  });

  const look = resolveCaptionLook(g.style, g.height);
  const ds = dialogues(ass);

  it('every Dialogue: same words on screen at its midpoint', () => {
    for (const d of ds) {
      const mid = (d.start + d.end) / 2;
      const f = captionFrameAt(g.cues, look, mid);
      expect([d.start, f !== null]).toEqual([d.start, true]);
      const mine = f!.words.map((w, i) => (i > 0 ? (/[\n\r]/.test(w.sep) ? '\n' : w.sep ? ' ' : '') : '') + w.text).join('');
      // The generator escapes braces to parentheses (ass.ts `assEscape`); the preview shows the text.
      const escaped = mine.replaceAll('{', '(').replaceAll('}', ')');
      expect([d.start, escaped]).toEqual([d.start, plain(d.text)]);
    }
  });

  it('outside every Dialogue nothing shows', () => {
    const covered = (t: number) => ds.some((d) => t >= d.start && t < d.end);
    const end = Math.max(...g.cues.map((c) => c.endSeconds), 0) + 0.5;
    for (let t = 0; t < end; t += 0.05) {
      if (covered(t) || ds.some((d) => Math.abs(t - d.start) < 0.011 || Math.abs(t - d.end) < 0.011)) continue;
      expect([t.toFixed(2), captionFrameAt(g.cues, look, t)]).toEqual([t.toFixed(2), null]);
    }
  });

  const perWord = ['highlight', 'pop', 'bounce', 'word_by_word', 'box_highlight', 'typewriter', 'glow'];
  if (perWord.includes(look.animation)) {
    it('per-word animations: the active word is the one the Dialogue animates', () => {
      for (const d of ds) {
        const f = captionFrameAt(g.cues, look, (d.start + d.end) / 2)!;
        // The active word carries the animation's opening tag (\t, \1c, \3c or an alpha reveal).
        const runs = d.text.split(/(\{[^}]*\})/);
        let idx = -1;
        let word = -1;
        for (let i = 0; i < runs.length; i += 1) {
          const r = runs[i]!;
          // Count caption units with the copied unit splitter (CJK units are per character).
          if (!r.startsWith('{') && r.trim()) word += captionUnits(r).length;
          if (r.startsWith('{') && /\\t\(|\\3c|\\fscx1[0-9][1-9]/.test(r) && !/fscx100\\fscy100\}$/.test(r) && idx < 0) idx = word + 1;
        }
        if (idx >= 0 && look.animation !== 'typewriter') expect([d.start, f.active]).toEqual([d.start, idx]);
      }
    });
  }
});

describe('animation approximations', () => {
  it('fade: 0 at the group start, 1 in the middle, 0 at the end', () => {
    const look = resolveCaptionLook({ fontSizePct: 5, color: '#FFFFFF', backgroundColor: '#000000', backgroundOpacity: 0.5, position: 'bottom', maxWidthPct: 90, animation: 'fade' }, 1080);
    const cues: StudioCaptionCue[] = [{ id: 'c', startSeconds: 1, endSeconds: 3, text: 'hello there' }];
    const f = captionFrameAt(cues, look, 2)!;
    expect(captionFade(look, f, 1)).toBe(0);
    expect(captionFade(look, f, 2)).toBe(1);
    expect(captionFade(look, f, 2.9999)).toBeLessThan(0.01);
  });

  it('pop and bounce pulse the active word and settle', () => {
    const pop = resolveCaptionLook({ fontSizePct: 5, color: '#FFFFFF', backgroundColor: '#000000', backgroundOpacity: 0.5, position: 'bottom', maxWidthPct: 90, animation: 'pop', animationStrength: 1 }, 1080);
    expect(activeScale(pop, 0.08)).toEqual([1.4, 1.4]);
    expect(activeScale(pop, 0.5)).toEqual([1, 1]);
    const bounce = { ...pop, animation: 'bounce' };
    expect(activeScale(bounce, 0.09)[1]).toBeCloseTo(1.45, 9);
    expect(activeScale(bounce, 0.3)).toEqual([1, 1]);
  });
});
