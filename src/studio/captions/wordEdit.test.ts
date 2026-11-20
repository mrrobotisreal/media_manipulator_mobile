// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/captions/wordEdit.test.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import { describe, expect, it } from 'vitest';
import type { StudioCaptionCue } from '../studioTypes';
import { buildPreviewASS } from './ass';
import { sanitizeCaptionWords } from './sanitize';
import { cueRetimed, resetCueTimes, retimeBoundary, snapToFrame, toggleEmphasis, wordBoundaries } from './wordEdit';

const cue: StudioCaptionCue = {
  id: 'c', startSeconds: 1, endSeconds: 4, text: 'one two three',
  words: [
    { text: 'one', startSeconds: 1.1, endSeconds: 1.8 },
    { text: 'two', startSeconds: 1.9, endSeconds: 2.6 },
    { text: 'three', startSeconds: 2.7, endSeconds: 3.6 },
  ],
};

describe('per-word caption editor (MM122 decision 3)', () => {
  it('snaps to one frame of the project', () => {
    expect(snapToFrame(1.234, 30)).toBeCloseTo(1.233333, 5);
    expect(snapToFrame(1.234, 25)).toBeCloseTo(1.24, 6);
    expect(wordBoundaries(cue)).toEqual([1.1, 1.9, 2.7, 3.6]);
  });

  it('a boundary drag moves the start of one word and the end of the previous, snapped', () => {
    const ws = retimeBoundary(cue, 1, 2.012, 30)!;
    expect(ws[1].startSeconds).toBeCloseTo(2, 6);
    expect(ws[0].endSeconds).toBeCloseTo(2, 6);
    expect(ws[2]).toBe(cue.words![2]);
    // Whisper's times are kept for "Re-time from audio".
    expect(ws[1].origStartSeconds).toBe(1.9);
    expect(ws[0].origEndSeconds).toBe(1.8);
  });

  it('clamps between the neighbouring boundaries (a word keeps one frame) and inside the cue', () => {
    const f = 1 / 30;
    expect(retimeBoundary(cue, 1, 0, 30)![1].startSeconds).toBeCloseTo(1.1 + f, 6);
    expect(retimeBoundary(cue, 1, 9, 30)![1].startSeconds).toBeCloseTo(2.7 - f, 6);
    expect(retimeBoundary(cue, 0, -5, 30)![0].startSeconds).toBe(1);
    expect(retimeBoundary(cue, 3, 99, 30)![2].endSeconds).toBe(4);
    // nothing moves: same array, no orig times written
    expect(retimeBoundary(cue, 2, 2.7, 30)).toBe(cue.words);
  });

  it('the result passes the API sanitizer unchanged (orig times included)', () => {
    const next = { ...cue, words: retimeBoundary(cue, 2, 3, 30) };
    expect(sanitizeCaptionWords(next)).toEqual(next.words);
  });

  it('a click toggles emphasis on one word, and the generator colours it', () => {
    const on = { ...cue, words: toggleEmphasis(cue, 1) };
    expect(on.words![1].emphasis).toBe(true);
    expect(buildPreviewASS([on], { fontSizePct: 5, color: '#FFFFFF', backgroundColor: '#000000', backgroundOpacity: 0.5, position: 'bottom', maxWidthPct: 90 }, 1920, 1080)).toContain('{\\1c&H00D4FF&}two{\\1c&HFFFFFF&}');
    const off = toggleEmphasis(on, 1)!;
    expect('emphasis' in off[1]).toBe(false);
  });

  it('Re-time from audio restores Whisper times and keeps emphasis', () => {
    const edited = { ...cue, words: toggleEmphasis({ ...cue, words: retimeBoundary(cue, 1, 2.2, 30) }, 0) };
    expect(cueRetimed(edited)).toBe(true);
    const reset = resetCueTimes(edited)!;
    expect(reset.map((w) => [w.startSeconds, w.endSeconds])).toEqual(cue.words!.map((w) => [w.startSeconds, w.endSeconds]));
    expect(reset[0].emphasis).toBe(true);
    expect(reset.some((w) => 'origStartSeconds' in w)).toBe(false);
    expect(cueRetimed({ ...cue, words: reset })).toBe(false);
  });
});
