// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/ease.test.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import { describe, expect, it } from 'vitest';
import fixtures from './ease.fixtures.json';
import { easedProgress, valueAt } from './ease';
import type { StudioKeyframe } from './studioTypes';

/**
 * The fixture table is the cross-side contract (part 15): the Go mirror
 * (internal/services/studio_keyframes.go) asserts KeyframeValueAt against a
 * byte-identical copy of ease.fixtures.json, so a curve change that only lands
 * on one side fails that side's gate.
 */
describe('valueAt (shared curve fixture)', () => {
  for (const c of fixtures.cases) {
    describe(c.name, () => {
      for (const s of c.samples) {
        it(`t=${s.t} → ${s.expected}`, () => {
          expect(valueAt(c.keyframes as StudioKeyframe[], s.t)).toBeCloseTo(s.expected, 9);
        });
      }
    });
  }
});

describe('valueAt edge cases', () => {
  it('returns the fallback for an empty/absent lane', () => {
    expect(valueAt(undefined, 1, 0.25)).toBe(0.25);
    expect(valueAt([], 1, 2)).toBe(2);
  });

  it('coincident keyframes do not divide by zero', () => {
    const kfs: StudioKeyframe[] = [
      { t: 1, value: 0, ease: 'linear' },
      { t: 1, value: 5, ease: 'linear' },
      { t: 2, value: 10, ease: 'linear' },
    ];
    expect(Number.isFinite(valueAt(kfs, 1))).toBe(true);
    expect(valueAt(kfs, 1.5)).toBeCloseTo(7.5, 9);
  });
});

describe('easedProgress', () => {
  it('clamps progress outside 0..1', () => {
    expect(easedProgress('linear', -0.5)).toBe(0);
    expect(easedProgress('easeBoth', 1.5)).toBe(1);
  });

  it('hold always returns 0 (outgoing value holds)', () => {
    expect(easedProgress('hold', 0.99)).toBe(0);
  });

  it('the curves meet their endpoints', () => {
    for (const ease of ['linear', 'easeIn', 'easeOut', 'easeBoth'] as const) {
      expect(easedProgress(ease, 0)).toBe(0);
      expect(easedProgress(ease, 1)).toBe(1);
    }
  });
});
