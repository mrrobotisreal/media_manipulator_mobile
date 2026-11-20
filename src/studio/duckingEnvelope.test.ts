// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/duckingEnvelope.test.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import { describe, expect, it } from 'vitest';
import {
  DUCK_THRESHOLD,
  INITIAL_DUCK_ENVELOPE,
  advanceEnvelope,
  bedGainForVoiceLevel,
  duckCompressionRatio,
  peakLevelAt,
  type PeaksLike,
} from './duckingEnvelope';

// Synthetic peaks: 50 buckets/s, 2 s — first second silence, second second a
// full-scale square (min −127 / max 127).
function syntheticPeaks(): PeaksLike {
  const buckets = 100;
  const peaks = new Int8Array(buckets * 2);
  for (let i = 50; i < 100; i += 1) {
    peaks[i * 2] = -127;
    peaks[i * 2 + 1] = 127;
  }
  return { bucketsPerSecond: 50, length: buckets, peaks };
}

describe('duckCompressionRatio', () => {
  it('mirrors the Go duckRatio heuristic (1 + dB, clamped 1..20)', () => {
    expect(duckCompressionRatio(9)).toBe(10);
    expect(duckCompressionRatio(-5)).toBe(1);
    expect(duckCompressionRatio(40)).toBe(20);
  });
});

describe('peakLevelAt', () => {
  const pk = syntheticPeaks();

  it('reads 0 in silence and 1 at full scale', () => {
    expect(peakLevelAt(pk, 0.5)).toBe(0);
    expect(peakLevelAt(pk, 1.5)).toBe(1);
  });

  it('uses the larger magnitude of the min/max pair', () => {
    const asym: PeaksLike = {
      bucketsPerSecond: 50,
      length: 1,
      peaks: Int8Array.from([-64, 10]),
    };
    expect(peakLevelAt(asym, 0)).toBeCloseTo(64 / 127);
  });

  it('clamps out-of-range times to the edge buckets', () => {
    expect(peakLevelAt(pk, -3)).toBe(0);
    expect(peakLevelAt(pk, 99)).toBe(1);
  });

  it('returns 0 for empty peaks', () => {
    expect(peakLevelAt({ bucketsPerSecond: 50, length: 0, peaks: new Int8Array(0) }, 1)).toBe(0);
  });
});

describe('bedGainForVoiceLevel', () => {
  it('leaves the bed alone below the sidechain threshold', () => {
    expect(bedGainForVoiceLevel(0, 12)).toBe(1);
    expect(bedGainForVoiceLevel(DUCK_THRESHOLD, 12)).toBe(1);
    expect(bedGainForVoiceLevel(0.015, 12)).toBe(1);
  });

  it('applies the sidechaincompress transfer curve above threshold', () => {
    // amountDb 12 → ratio 13; level 1 → (0.02 + 0.98/13) / 1
    expect(bedGainForVoiceLevel(1, 12)).toBeCloseTo(0.02 + 0.98 / 13, 6);
  });

  it('ducks harder as the voice gets louder', () => {
    const quiet = bedGainForVoiceLevel(0.1, 12);
    const loud = bedGainForVoiceLevel(0.9, 12);
    expect(loud).toBeLessThan(quiet);
    expect(quiet).toBeLessThan(1);
  });

  it('is a no-op at ratio 1 (amountDb 0)', () => {
    expect(bedGainForVoiceLevel(1, 0)).toBe(1);
  });
});

describe('advanceEnvelope', () => {
  const cfg = { attackMs: 100, releaseMs: 400 };

  it('snaps to the target on the first sample', () => {
    const s = advanceEnvelope(INITIAL_DUCK_ENVELOPE, 0.25, 3, cfg);
    expect(s).toEqual({ gain: 0.25, t: 3 });
  });

  it('follows a one-pole exponential toward the target', () => {
    let s = advanceEnvelope(INITIAL_DUCK_ENVELOPE, 1, 0, cfg);
    // attack: dt of one time constant covers 1 − 1/e of the step down to 0.1
    s = advanceEnvelope(s, 0.1, 0.1, cfg);
    expect(s.gain).toBeCloseTo(0.1 + 0.9 * Math.exp(-1), 6);
  });

  it('attacks faster than it releases', () => {
    const down = advanceEnvelope({ gain: 1, t: 0 }, 0, 0.05, cfg).gain;
    const up = 1 - advanceEnvelope({ gain: 0, t: 0 }, 1, 0.05, cfg).gain;
    expect(down).toBeLessThan(up);
  });

  it('snaps on seeks (backwards jumps and gaps > 0.5 s)', () => {
    expect(advanceEnvelope({ gain: 1, t: 10 }, 0.2, 9, cfg)).toEqual({ gain: 0.2, t: 9 });
    expect(advanceEnvelope({ gain: 1, t: 10 }, 0.2, 11, cfg)).toEqual({ gain: 0.2, t: 11 });
  });
});
