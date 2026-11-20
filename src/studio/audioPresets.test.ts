// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/audioPresets.test.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import { describe, expect, it } from 'vitest';
import { studioTrackEffectsSchema } from './studioTypes';
import { STUDIO_V3_RANGES } from './effectRegistry';
import { AUDIO_PRESETS, matchingPreset, normalizeTrackEffects, presetById, presetEffects } from './audioPresets';

describe('audio presets', () => {
  it('ships the three named presets', () => {
    expect(AUDIO_PRESETS.map((p) => p.label)).toEqual(['Voice clarity', 'Music bed', 'Podcast']);
  });
  it.each(AUDIO_PRESETS)('$id stays inside the registry ranges and the Zod schema', (p) => {
    const eqR = STUDIO_V3_RANGES.eqGainDb;
    for (const v of Object.values(p.eq)) {
      expect(v).toBeGreaterThanOrEqual(eqR.min);
      expect(v).toBeLessThanOrEqual(eqR.max);
    }
    const r = STUDIO_V3_RANGES.compressor;
    for (const k of ['thresholdDb', 'ratio', 'attackMs', 'releaseMs', 'makeupDb'] as const) {
      expect(p.compressor[k], k).toBeGreaterThanOrEqual(r[k].min);
      expect(p.compressor[k], k).toBeLessThanOrEqual(r[k].max);
    }
    expect(() => studioTrackEffectsSchema.parse(presetEffects(p))).not.toThrow();
  });
  it('applying yields copies the user can edit without mutating the preset', () => {
    const p = presetById('podcast')!;
    const fx = presetEffects(p);
    fx.eq!.lowGainDb = 99;
    expect(p.eq.lowGainDb).not.toBe(99);
  });
  it('matchingPreset recognises exact matches and drops after an edit', () => {
    const fx = presetEffects(presetById('musicBed')!);
    expect(matchingPreset(fx)).toBe('musicBed');
    fx.compressor!.ratio += 1;
    expect(matchingPreset(fx)).toBeNull();
  });
  it('normalizeTrackEffects collapses neutral effects to undefined', () => {
    expect(normalizeTrackEffects(undefined)).toBeUndefined();
    expect(normalizeTrackEffects({ eq: { lowGainDb: 0, midGainDb: 0, highGainDb: 0 } })).toBeUndefined();
    expect(normalizeTrackEffects({ eq: { lowGainDb: 0, midGainDb: 1, highGainDb: 0 } })).toEqual({ eq: { lowGainDb: 0, midGainDb: 1, highGainDb: 0 } });
  });
});
