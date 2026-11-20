// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/clipTrimBound.test.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import { describe, expect, it } from 'vitest';
import { clipTrimBound } from './clipTrimBound';

describe('clipTrimBound', () => {
  it('is unbounded for images and titles', () => {
    expect(clipTrimBound({ mediaKind: 'image', durationSeconds: 0 }, false)).toBe(Infinity);
    expect(clipTrimBound(undefined, true)).toBe(Infinity);
  });
  it('is the asset duration for video and audio', () => {
    expect(clipTrimBound({ mediaKind: 'video', durationSeconds: 12.5 }, false)).toBe(12.5);
    expect(clipTrimBound({ mediaKind: 'audio', durationSeconds: 3 }, false)).toBe(3);
  });
  it('is 0 (no bound known) for a missing asset', () => {
    expect(clipTrimBound(undefined, false)).toBe(0);
  });
  it('clamps cleanly when used as the trim max delta', () => {
    const maxDelta = clipTrimBound({ mediaKind: 'image', durationSeconds: 0 }, false) - 5;
    expect(Math.min(Math.max(120, 0), maxDelta)).toBe(120);
  });
});
