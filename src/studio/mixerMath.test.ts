// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/mixerMath.test.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import { describe, expect, it } from 'vitest';
import {
  audioBearingTracks,
  dbToGain,
  fallbackElementVolume,
  faderPosToGain,
  formatDb,
  gainToDb,
  gainToFaderPos,
  masterGainOf,
  peakDb,
  trackLabel,
  trackNodeParams,
} from './mixerMath';
import type { StudioTrack } from './studioTypes';

const tr = (kind: 'video' | 'audio', extra: Partial<StudioTrack> = {}): StudioTrack => ({ id: 'x', kind, index: 0, muted: false, clips: [], ...extra });

describe('dB <-> gain', () => {
  it('maps the anchors', () => {
    expect(dbToGain(0)).toBeCloseTo(1, 9);
    expect(dbToGain(6.0206)).toBeCloseTo(2, 3);
    expect(gainToDb(1)).toBeCloseTo(0, 9);
    expect(gainToDb(0)).toBe(-Infinity);
    expect(gainToDb(0.5)).toBeCloseTo(-6.0206, 3);
  });
});

describe('fader curve', () => {
  it('bottom is -inf (gain 0), top is +6 dB (gain 2)', () => {
    expect(faderPosToGain(0)).toBe(0);
    expect(faderPosToGain(0.005)).toBe(0);
    expect(faderPosToGain(1)).toBeCloseTo(2, 6);
  });
  it('is monotonic and round-trips gains across the range', () => {
    let prev = -1;
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const g = faderPosToGain(p);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
    for (const g of [0.01, 0.1, 0.5, 1, 1.5, 2]) {
      expect(faderPosToGain(gainToFaderPos(g))).toBeCloseTo(g, 3);
    }
  });
  it('unity sits at a sensible spot (~90% of travel)', () => {
    expect(gainToFaderPos(1)).toBeGreaterThan(0.85);
    expect(gainToFaderPos(1)).toBeLessThan(0.95);
  });
  it('clamps out-of-range input and caps gain at 2', () => {
    expect(faderPosToGain(-1)).toBe(0);
    expect(faderPosToGain(5)).toBeLessThanOrEqual(2);
    expect(gainToFaderPos(0)).toBe(0);
    expect(gainToFaderPos(9)).toBe(1);
  });
});

describe('formatDb', () => {
  it('prints -inf, signed values and one decimal', () => {
    expect(formatDb(0)).toBe('-inf');
    expect(formatDb(1)).toBe('0.0');
    expect(formatDb(2)).toBe('+6.0');
    expect(formatDb(0.5)).toBe('-6.0');
  });
});

describe('peakDb', () => {
  it('reads the loudest sample, floored at -60', () => {
    expect(peakDb([0, 0.5, -1, 0.1])).toBeCloseTo(0, 6);
    expect(peakDb([0.1])).toBeCloseTo(-20, 6);
    expect(peakDb([0, 0])).toBe(-60);
    expect(peakDb([0.00001])).toBe(-60);
  });
});

describe('trackNodeParams', () => {
  it('defaults are transparent', () => {
    const p = trackNodeParams(tr('audio'));
    expect(p).toMatchObject({ lowDb: 0, midDb: 0, highDb: 0, gain: 1, pan: 0 });
    expect(p.comp.ratio).toBe(1);
    expect(p.comp.thresholdDb).toBe(0);
  });
  it('folds compressor makeup into the gain (the export applies it inside acompressor)', () => {
    const p = trackNodeParams(
      tr('audio', {
        gain: 0.5,
        pan: -0.25,
        effects: { compressor: { thresholdDb: -20, ratio: 4, attackMs: 10, releaseMs: 250, makeupDb: 6 } },
      }),
    );
    expect(p.gain).toBeCloseTo(0.5 * dbToGain(6), 9);
    expect(p.pan).toBe(-0.25);
    expect(p.comp).toMatchObject({ thresholdDb: -20, ratio: 4, attackS: 0.01, releaseS: 0.25, kneeDb: 9 });
  });
});

describe('composition (clip x track x master)', () => {
  it('multiplies and caps the element-volume fallback at 1.0', () => {
    expect(fallbackElementVolume(0.5, 0.5, 0.5)).toBeCloseTo(0.125, 9);
    expect(fallbackElementVolume(2, 2, 2)).toBe(1);
    expect(fallbackElementVolume(1, undefined, undefined)).toBe(1);
    expect(fallbackElementVolume(1, 0, 1)).toBe(0);
  });
  it('master defaults to unity', () => {
    expect(masterGainOf(undefined)).toBe(1);
    expect(masterGainOf({ masterGain: 0.4 })).toBe(0.4);
  });
});

describe('strips', () => {
  it('labels: name, else A1/V1', () => {
    expect(trackLabel({ kind: 'audio', index: 0 })).toBe('A1');
    expect(trackLabel({ kind: 'video', index: 1 })).toBe('V2');
    expect(trackLabel({ kind: 'audio', index: 0, name: '  Music ' })).toBe('Music');
  });
  it('audio tracks always get strips; video tracks only with embedded audio (not titles)', () => {
    const clip = (assetId: string, title?: true) =>
      ({ id: assetId + 'c', assetId, streamIndex: 0, timelineStart: 0, sourceIn: 0, sourceOut: 1, ...(title ? { title: {} } : {}) }) as never;
    const tracks = [
      tr('video', { id: 'v1', clips: [clip('av')] }),
      tr('video', { id: 'v2', index: 1, clips: [clip('silent')] }),
      tr('video', { id: 'v3', index: 2, clips: [clip('', true)] }),
      tr('audio', { id: 'a1' }),
    ];
    const assets = { av: { asset: { hasAudio: true } }, silent: { asset: { hasAudio: false } } };
    expect(audioBearingTracks(tracks, assets).map((t) => t.id)).toEqual(['a1', 'v1']);
  });
});
