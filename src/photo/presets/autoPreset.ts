// DO NOT EDIT. Copied from media-manipulator-ui lib/photo/presets/autoPreset.ts by scripts/sync-photo-fixtures.mjs
// (npm run photo:sync). The web repo is the source of the model and the math (ADR MA-0010);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/**
 * The Auto preset (design §5.5, MM99 decision 4): levels from the 0.5 % / 99.5 %
 * percentiles per channel, and white balance from the grey-world estimate (a
 * small search over `applyWhiteBalance` minimising the chroma of the mean
 * colour). The result is written as explicit params so the server render
 * reproduces it exactly; the percentiles come from the proxy's histogram.
 */
import { applyWhiteBalance, levelsChannel, type RGB } from '../colorMath';
import type { Histogram } from '../webHistogram';
import { LAYER_PARAMS, type AdjustmentLayer } from '../photoTypes';

export const AUTO_LOW_PERCENTILE = 0.005;
export const AUTO_HIGH_PERCENTILE = 0.995;

/** Bin index (0..255) where the cumulative share first reaches `q` of the pixels. */
export function histogramPercentile(bins: ArrayLike<number>, q: number): number {
  let total = 0;
  for (let i = 0; i < 256; i += 1) total += bins[i];
  if (total === 0) return q < 0.5 ? 0 : 255;
  const target = q * total;
  let acc = 0;
  for (let i = 0; i < 256; i += 1) {
    acc += bins[i];
    if (acc >= target) return i;
  }
  return 255;
}

const mean = (bins: ArrayLike<number>): number => {
  let n = 0;
  let s = 0;
  for (let i = 0; i < 256; i += 1) {
    n += bins[i];
    s += bins[i] * i;
  }
  return n === 0 ? 0.5 : s / n / 255;
};

const chroma = (c: RGB) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);

/** Temperature / tint (each -100..100, integers) that neutralise the mean colour. */
export function greyWorldWhiteBalance(meanRgb: RGB): { temperature: number; tint: number } {
  const wbParams = (temperature: number, tint: number) => LAYER_PARAMS.whiteBalance.parse({ temperature, tint }) as never;
  let best = { temperature: 0, tint: 0, c: chroma(applyWhiteBalance(meanRgb, wbParams(0, 0))) };
  const scan = (t0: number, t1: number, ts: number, i0: number, i1: number, is: number) => {
    for (let t = t0; t <= t1; t += ts) {
      for (let i = i0; i <= i1; i += is) {
        const tt = Math.max(-100, Math.min(100, t));
        const ti = Math.max(-100, Math.min(100, i));
        const c = chroma(applyWhiteBalance(meanRgb, wbParams(tt, ti)));
        if (c < best.c - 1e-12) best = { temperature: tt, tint: ti, c };
      }
    }
  };
  scan(-100, 100, 10, -100, 100, 10);
  scan(best.temperature - 9, best.temperature + 9, 1, best.tint - 9, best.tint + 9, 1);
  return { temperature: best.temperature, tint: best.tint };
}

export interface AutoResult {
  layers: AdjustmentLayer[];
  levels: { r: [number, number]; g: [number, number]; b: [number, number] };
  whiteBalance: { temperature: number; tint: number };
}

/** The Auto preset's layers (levels then white balance) for a histogram. */
export function computeAutoPreset(h: Pick<Histogram, 'r' | 'g' | 'b'>): AutoResult {
  const span = (bins: ArrayLike<number>): [number, number] => {
    const lo = histogramPercentile(bins, AUTO_LOW_PERCENTILE);
    let hi = histogramPercentile(bins, AUTO_HIGH_PERCENTILE);
    if (hi <= lo) hi = Math.min(255, lo + 1);
    return [lo / 255, hi / 255];
  };
  const r = span(h.r);
  const g = span(h.g);
  const b = span(h.b);
  const lv = (s: [number, number]) => ({ inBlack: s[0], inWhite: s[1] });
  const levelsParams = LAYER_PARAMS.levels.parse({ r: lv(r), g: lv(g), b: lv(b) }) as never;
  // Mean colour after the levels stretch (grey-world on the stretched image).
  const meanRgb: RGB = [
    levelsChannel(mean(h.r), { inBlack: r[0], inWhite: r[1], gamma: 1, outBlack: 0, outWhite: 1 }),
    levelsChannel(mean(h.g), { inBlack: g[0], inWhite: g[1], gamma: 1, outBlack: 0, outWhite: 1 }),
    levelsChannel(mean(h.b), { inBlack: b[0], inWhite: b[1], gamma: 1, outBlack: 0, outWhite: 1 }),
  ];
  const wb = greyWorldWhiteBalance(meanRgb);
  const base = { enabled: true, opacity: 1, blend: 'normal', mask: null } as const;
  const layers = [
    { ...base, id: 'auto-levels', type: 'levels', params: levelsParams },
    { ...base, id: 'auto-wb', type: 'whiteBalance', params: LAYER_PARAMS.whiteBalance.parse(wb) },
  ] as unknown as AdjustmentLayer[];
  return { layers, levels: { r, g, b }, whiteBalance: wb };
}
