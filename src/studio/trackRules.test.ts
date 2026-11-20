// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/trackRules.test.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import { describe, expect, it } from 'vitest';
import { trackAcceptsAsset } from './trackRules';

describe('trackAcceptsAsset', () => {
  const table: Array<['video' | 'audio', 'video' | 'audio' | 'image' | 'lut', boolean]> = [
    ['video', 'video', true],
    ['video', 'image', true],
    ['video', 'audio', false],
    ['video', 'lut', false],
    ['audio', 'audio', true],
    ['audio', 'image', false],
    ['audio', 'video', false],
    ['audio', 'lut', false],
  ];
  it.each(table)('%s track + %s asset -> %s', (track, asset, expected) => {
    expect(trackAcceptsAsset(track, asset)).toBe(expected);
  });
});
