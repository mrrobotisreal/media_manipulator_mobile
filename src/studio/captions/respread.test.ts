// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/captions/respread.test.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import { describe, expect, it } from 'vitest';
import type { StudioCaptionCue } from '../studioTypes';
import { patchCueKeepingWords, respreadWords } from './respread';
import { sanitizeCaptionWords } from './sanitize';

const cue: StudioCaptionCue = {
  id: 'c', startSeconds: 1, endSeconds: 3, text: 'the cat saw the dog',
  words: [
    { text: 'the', startSeconds: 1, endSeconds: 1.3 },
    { text: 'cat', startSeconds: 1.3, endSeconds: 1.7 },
    { text: 'saw', startSeconds: 1.8, endSeconds: 2.1 },
    { text: 'the', startSeconds: 2.2, endSeconds: 2.4, emphasis: true },
    { text: 'dog', startSeconds: 2.4, endSeconds: 2.9 },
  ],
};
const accepted = (c: StudioCaptionCue) => expect(sanitizeCaptionWords(c)).toEqual(c.words);

describe('respreadWords (decision 3)', () => {
  it('unchanged words keep their times by position; a repeated word keeps its own', () => {
    const next = patchCueKeepingWords(cue, { text: 'the cat saw the frog' });
    expect(next.words!.map((w) => [w.text, w.startSeconds])).toEqual([['the', 1], ['cat', 1.3], ['saw', 1.8], ['the', 2.2], ['frog', 2.4]]);
    expect(next.words![3].emphasis).toBe(true);
    accepted(next);
  });

  it('inserted words split the neighbouring gap by character count', () => {
    const next = patchCueKeepingWords(cue, { text: 'the cat really saw the dog' });
    const ws = next.words!;
    expect(ws.map((w) => w.text)).toEqual(['the', 'cat', 'really', 'saw', 'the', 'dog']);
    expect(ws[0].startSeconds).toBe(1);
    expect(ws[4].startSeconds).toBe(2.2);
    // 'really' fills the gap between 'cat' (ends 1.7) and 'saw' (starts 1.8); 'saw' keeps its time.
    expect(ws[2]).toMatchObject({ startSeconds: 1.7, endSeconds: 1.8 });
    expect(ws[3]).toMatchObject({ startSeconds: 1.8, endSeconds: 2.1 });
    // Two inserted words share their gap by character count (3 + 6 chars over 1.7–1.8).
    const two = patchCueKeepingWords(cue, { text: 'the cat big really saw the dog' }).words!;
    expect(two[2]).toMatchObject({ text: 'big', startSeconds: 1.7, endSeconds: 1.733 });
    expect(two[3]).toMatchObject({ text: 'really', startSeconds: 1.733, endSeconds: 1.8 });
    accepted(next);
  });

  it('deleted words drop; the rest keep their times', () => {
    const next = patchCueKeepingWords(cue, { text: 'the cat the dog' });
    expect(next.words!.map((w) => [w.text, w.startSeconds])).toEqual([['the', 1], ['cat', 1.3], ['the', 2.2], ['dog', 2.4]]);
    accepted(next);
  });

  it('a retime scales the words into the new window', () => {
    const next = patchCueKeepingWords(cue, { startSeconds: 2, endSeconds: 6 });
    expect(next.words![0]).toMatchObject({ startSeconds: 2, endSeconds: 2.6 });
    expect(next.words![4].endSeconds).toBe(5.8);
    accepted(next);
  });

  it('a cue without words stays without; an emptied cue drops them', () => {
    const plain = { id: 'p', startSeconds: 0, endSeconds: 1, text: 'hi there' };
    expect(patchCueKeepingWords(plain, { text: 'hello there' })).not.toHaveProperty('words');
    expect(respreadWords(cue, { text: '   ', startSeconds: 1, endSeconds: 3 })).toBeUndefined();
  });

  it('CJK edits spread per character', () => {
    const zh: StudioCaptionCue = { id: 'z', startSeconds: 0, endSeconds: 1, text: '你好', words: [{ text: '你', startSeconds: 0, endSeconds: 0.5 }, { text: '好', startSeconds: 0.5, endSeconds: 1 }] };
    const next = patchCueKeepingWords(zh, { text: '你很好' });
    expect(next.words!.map((w) => w.text)).toEqual(['你', '很', '好']);
    accepted(next);
  });

  it('an explicit words patch wins', () => {
    const ws = [{ text: 'x', startSeconds: 1, endSeconds: 2 }];
    expect(patchCueKeepingWords(cue, { text: 'x', words: ws }).words).toBe(ws);
  });
});
