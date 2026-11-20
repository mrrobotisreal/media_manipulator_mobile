// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/captions/effects.test.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import { describe, expect, it } from 'vitest';
import type { StudioCaptionCue, StudioCaptionStyle } from '../studioTypes';
import { buildASS, captionClusters } from './ass';

/** MM122 effect rules (the TS twin of TestCaptionEffectsMM122; the goldens hold the rest). */
describe('MM122 caption effects', () => {
  const base: StudioCaptionStyle = { fontSizePct: 5, color: '#FFFFFF', backgroundColor: '#000000', backgroundOpacity: 0.5, position: 'bottom', maxWidthPct: 90, animationStrength: 1 };
  const words: StudioCaptionCue = { id: 'w', startSeconds: 0, endSeconds: 2, text: 'one two', words: [
    { text: 'one', startSeconds: 0.5, endSeconds: 1 }, { text: 'two', startSeconds: 1, endSeconds: 1.5, emphasis: true }] };

  it('fade shrinks in and out in proportion when the group is short', () => {
    const out = buildASS([{ id: 'c', startSeconds: 1, endSeconds: 1.2, text: 'Hi' }], { ...base, animation: 'fade' }, 1920, 1080);
    expect(out).toContain('{\\fad(129,70)}Hi');
  });

  it('typewriter keeps combining marks with their base character', () => {
    expect(captionClusters('café naïve').join('|')).toBe('c|a|f|é| |n|a|ï|v|e');
  });

  it('a revealing animation draws nothing before the first word, and boxes nothing not yet revealed', () => {
    const out = buildASS([words], { ...base, animation: 'typewriter', backgroundMode: 'word_box' }, 1920, 1080);
    expect(out).not.toContain('Dialogue: 1,0:00:00.00');
    expect(out).not.toContain('Dialogue: 0,0:00:00.00');
    expect(out).toContain('{\\3a&HFF&}{\\3a&H00&}one{\\3a&HFF&} two');
  });

  it('box_highlight brings the WordBox layer and never recolours the fill', () => {
    const out = buildASS([words], { ...base, animation: 'box_highlight' }, 1920, 1080);
    expect(out).toContain('Style: WordBox,');
    expect(out).not.toContain('\\1c');
  });
});
