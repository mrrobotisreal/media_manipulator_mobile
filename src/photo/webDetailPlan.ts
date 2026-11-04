// DO NOT EDIT. Copied from media-manipulator-ui lib/photo/gl/detailPlan.ts by scripts/sync-photo-fixtures.mjs
// (npm run photo:sync). The web repo is the source of the model and the math (ADR MA-0010);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/**
 * Pure (GPU-free) planning of the rung-4 detail passes (design §5.4, MM99):
 * which multi-pass program chain a detail layer needs and with what numbers.
 * The renderer sequences the chain; `shaders/detailSource.ts` implements it;
 * `colorMath.ts` is the reference. Tests pin the numbers.
 */
import {
  CLARITY_GAIN,
  CLARITY_RADIUS,
  NR_CHROMA_SIGMA,
  TEXTURE_GAIN,
  TEXTURE_MIN_RADIUS,
  TEXTURE_RADIUS,
  isDetailType,
} from './colorMath';
import type { AdjustmentLayer } from './photoTypes';

export type DetailPlan =
  | { kind: 'unsharp'; sigma: number; gain: number; mid: boolean; threshold: number }
  | { kind: 'blur'; sigma: number }
  | { kind: 'nr'; sigmaS: number; sigmaR: number; chroma: number; luma: boolean }
  | { kind: 'dehaze'; amount: number }
  | { kind: 'vignette'; amount: number; midpoint: number; roundness: number; feather: number; highlights: number }
  | { kind: 'grain'; amount: number; size: number; roughness: number; seed: number };

export { isDetailType };

/** Number of Gaussian taps the shader loops are capped at (3σ ≤ 400). */
export const MAX_GPU_SIGMA = 133;

/** The plan for a detail layer on a `w`×`h` image, or null when the layer is a no-op. */
export function planDetail(layer: AdjustmentLayer, w: number, h: number): DetailPlan | null {
  const long = Math.max(w, h);
  switch (layer.type) {
    case 'sharpen':
      return { kind: 'unsharp', sigma: Math.min(layer.params.radius, MAX_GPU_SIGMA), gain: layer.params.amount / 100, mid: false, threshold: layer.params.threshold / 255 };
    case 'blur': {
      const sigma = layer.params.radius / 2;
      return sigma < 1e-3 ? null : { kind: 'blur', sigma: Math.min(sigma, MAX_GPU_SIGMA) };
    }
    case 'noiseReduction': {
      const { luminance, color } = layer.params;
      if (luminance <= 0 && color <= 0) return null;
      const l = luminance / 100;
      return { kind: 'nr', sigmaS: 2 + l * 6, sigmaR: Math.max(l * 0.2, 1e-3), chroma: color > 0 ? (color / 100) * NR_CHROMA_SIGMA : 0, luma: luminance > 0 };
    }
    case 'clarity':
      return { kind: 'unsharp', sigma: Math.min(CLARITY_RADIUS * long, MAX_GPU_SIGMA), gain: (layer.params.amount / 100) * CLARITY_GAIN, mid: true, threshold: 0 };
    case 'texture':
      return { kind: 'unsharp', sigma: Math.min(Math.max(TEXTURE_MIN_RADIUS, TEXTURE_RADIUS * long), MAX_GPU_SIGMA), gain: (layer.params.amount / 100) * TEXTURE_GAIN, mid: false, threshold: 0 };
    case 'dehaze':
      return layer.params.amount === 0 ? null : { kind: 'dehaze', amount: layer.params.amount / 100 };
    case 'vignette': {
      const p = layer.params;
      return { kind: 'vignette', amount: p.amount / 100, midpoint: p.midpoint / 100, roundness: p.roundness / 100, feather: p.feather / 100, highlights: p.highlights / 100 };
    }
    case 'grain':
      return { kind: 'grain', amount: layer.params.amount / 100, size: layer.params.size, roughness: layer.params.roughness / 100, seed: layer.params.seed >>> 0 };
    default:
      return null;
  }
}

/** Side of the square sample grid the dehaze pass reads back for the 99.5th percentile. */
export const DEHAZE_GRID = 64;
