// DO NOT EDIT. Copied from media-manipulator-ui parity-harness/imageMetrics.test.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import { describe, expect, it } from 'vitest';
import type { ParityTolerance } from '../parityTolerances';
import {
  ASSUMED_DELTAE_FLOOR,
  ASSUMED_PSNR_FLOOR,
  SWIFTSHADER_HEADROOM,
  ciede2000,
  diffImage,
  effectiveThreshold,
  evaluateMetric,
  meanDeltaE,
  psnr,
  srgbToLab,
  type FrameBuf,
} from './imageMetrics';

function frame(width: number, height: number, fill: (i: number) => [number, number, number]): FrameBuf {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const [r, g, b] = fill(i);
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

describe('psnr', () => {
  it('is Infinity for identical frames', () => {
    const a = frame(8, 8, (i) => [i * 3 % 256, 50, 200]);
    expect(psnr(a, a)).toBe(Infinity);
  });

  it('matches the closed form for a uniform ±1 error', () => {
    const a = frame(16, 16, () => [100, 100, 100]);
    const b = frame(16, 16, () => [101, 101, 101]);
    // MSE = 1 → PSNR = 10·log10(255²) ≈ 48.13 dB.
    expect(psnr(a, b)).toBeCloseTo(10 * Math.log10(255 * 255), 5);
  });

  it('ignores alpha', () => {
    const a = frame(4, 4, () => [10, 20, 30]);
    const b = frame(4, 4, () => [10, 20, 30]);
    b.data[3] = 0; // corrupt an alpha byte only
    expect(psnr(a, b)).toBe(Infinity);
  });

  it('rejects mismatched dimensions', () => {
    expect(() => psnr(frame(2, 2, () => [0, 0, 0]), frame(4, 4, () => [0, 0, 0]))).toThrow(/mismatch/);
  });
});

describe('srgbToLab', () => {
  it('maps white to L=100, a≈0, b≈0', () => {
    const [L, a, b] = srgbToLab(255, 255, 255);
    expect(L).toBeCloseTo(100, 2);
    expect(a).toBeCloseTo(0, 1);
    expect(b).toBeCloseTo(0, 1);
  });

  it('maps black to the origin', () => {
    expect(srgbToLab(0, 0, 0)).toEqual([0, 0, 0]);
  });

  it('maps sRGB red to the reference Lab value', () => {
    const [L, a, b] = srgbToLab(255, 0, 0);
    expect(L).toBeCloseTo(53.23, 1);
    expect(a).toBeCloseTo(80.11, 1);
    expect(b).toBeCloseTo(67.22, 1);
  });
});

describe('ciede2000 (Sharma et al. 2005 reference pairs)', () => {
  const cases: Array<[[number, number, number], [number, number, number], number]> = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[50, 2.5, 0], [50, 3.2592, 0.335], 1.0],
  ];
  it.each(cases)('ΔE(%j, %j) = %f', (lab1, lab2, expected) => {
    expect(ciede2000(lab1, lab2)).toBeCloseTo(expected, 4);
    // Symmetric by definition.
    expect(ciede2000(lab2, lab1)).toBeCloseTo(expected, 4);
  });

  it('is 0 for identical colors', () => {
    expect(ciede2000([61.2, 10.1, -5.5], [61.2, 10.1, -5.5])).toBe(0);
  });
});

describe('meanDeltaE', () => {
  it('is 0 for identical frames and > 0 for shifted ones', () => {
    const a = frame(8, 8, (i) => [i, 128, 64]);
    expect(meanDeltaE(a, a)).toBe(0);
    const b = frame(8, 8, (i) => [i, 140, 64]);
    expect(meanDeltaE(a, b)).toBeGreaterThan(0);
  });
});

describe('diffImage', () => {
  it('amplifies and clamps the per-channel difference, alpha opaque', () => {
    const a = frame(2, 1, () => [100, 0, 255]);
    const b = frame(2, 1, () => [110, 0, 0]);
    const d = diffImage(a, b, 4);
    expect([...d.data.slice(0, 4)]).toEqual([40, 0, 255, 255]);
  });
});

describe('tolerance calibration', () => {
  const psnrRow: ParityTolerance = { id: 'x', metric: 'psnr', threshold: 38, status: 'closed', note: '' };
  const deltaERow: ParityTolerance = { id: 'y', metric: 'deltaE', threshold: 2.5, status: 'closed', note: '' };

  it('shifts PSNR rows down by the floor shortfall only', () => {
    expect(effectiveThreshold(psnrRow, { psnr: ASSUMED_PSNR_FLOOR, deltaE: 1 }, false)).toBe(38);
    expect(effectiveThreshold(psnrRow, { psnr: 43, deltaE: 1 }, false)).toBe(38); // better floor never tightens
    expect(effectiveThreshold(psnrRow, { psnr: 37, deltaE: 1 }, false)).toBe(35);
  });

  it('widens ΔE rows by the floor excess only', () => {
    expect(effectiveThreshold(deltaERow, { psnr: 40, deltaE: ASSUMED_DELTAE_FLOOR }, false)).toBe(2.5);
    expect(effectiveThreshold(deltaERow, { psnr: 40, deltaE: 0.4 }, false)).toBe(2.5);
    expect(effectiveThreshold(deltaERow, { psnr: 40, deltaE: 1.6 }, false)).toBeCloseTo(3.1, 10);
  });

  it('adds SwiftShader headroom in fallback mode', () => {
    expect(effectiveThreshold(psnrRow, { psnr: 40, deltaE: 1 }, true)).toBe(38 - SWIFTSHADER_HEADROOM.psnr);
    expect(effectiveThreshold(deltaERow, { psnr: 40, deltaE: 1 }, true)).toBe(2.5 + SWIFTSHADER_HEADROOM.deltaE);
  });

  it('evaluates pass direction per metric', () => {
    const floor = { psnr: 40, deltaE: 1 };
    expect(evaluateMetric(psnrRow, 39, floor, false).pass).toBe(true);
    expect(evaluateMetric(psnrRow, 37.9, floor, false).pass).toBe(false);
    expect(evaluateMetric(deltaERow, 2.4, floor, false).pass).toBe(true);
    expect(evaluateMetric(deltaERow, 2.6, floor, false).pass).toBe(false);
  });
});
