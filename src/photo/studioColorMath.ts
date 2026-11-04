// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/colorMath.ts by scripts/sync-photo-fixtures.mjs
// (npm run photo:sync). The web repo is the source of the model and the math (ADR MA-0010);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/**
 * colorMath — pure TS reference for the Content Studio color pipeline.
 *
 * This module is the NORMATIVE statement of the math that both renderers
 * implement: the WebGL fragment shader (lib/studio/glCompositor.ts) mirrors
 * these functions in GLSL, and the ffmpeg export chain (lumetriArgs/eqArg in
 * media_manipulator_api/internal/services/studio_export.go) emits the filters
 * whose per-pixel behavior they reproduce (verified against ffmpeg 7.1
 * vf_colorbalance.c / vf_vibrance.c / vf_eq.c / blend_modes.c). Unit tests here
 * pin the constants; the part-13 parity harness enforces the rendered result
 * within the tolerances in lib/studio/parityTolerances.ts.
 *
 * All values are linear 0..1 RGB; every stage clamps its output like the 8-bit
 * ffmpeg filter it mirrors.
 */

export type RGB = [number, number, number];

/** BT.709 luma — used by the eq contrast/saturation stage. */
export const EQ_LUMA: RGB = [0.2126, 0.7152, 0.0722];

/**
 * vf_vibrance's luma coefficients as applied to (r,g,b). Note the r/b weights
 * are swapped vs BT.709 — we mirror the filter's actual behavior, not the
 * standard.
 */
export const VIBRANCE_LUMA: RGB = [0.072186, 0.715158, 0.212656];

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

const luma = (c: RGB, w: RGB): number => c[0] * w[0] + c[1] * w[1] + c[2] * w[2];

/**
 * ffmpeg `eq` contrast/saturation (+brightness): contrast scales luma about
 * 0.5 and brightness shifts it; saturation scales chroma INDEPENDENTLY of the
 * luma contrast (eq gives the chroma planes contrast=saturation).
 */
export function eqAdjust(c: RGB, brightness: number, contrast: number, saturation: number): RGB {
  const l = luma(c, EQ_LUMA);
  const nl = (l - 0.5) * contrast + 0.5 + brightness;
  return [
    clamp01(nl + (c[0] - l) * saturation),
    clamp01(nl + (c[1] - l) * saturation),
    clamp01(nl + (c[2] - l) * saturation),
  ];
}

/**
 * ffmpeg `colorbalance` midtones (get_component in vf_colorbalance.c):
 * lightness = (max+min)/2, weight = clip((l−⅓)·4+.5)·clip((1−l−⅓)·4+.5)·0.7,
 * each channel gets its midtone amount added under that weight. Shadows and
 * highlights stay at 0 (the export only emits rm/gm/bm).
 */
export function colorBalanceMidtoneWeight(c: RGB): number {
  const l = 0.5 * (Math.max(...c) + Math.min(...c));
  return clamp01((l - 0.333) * 4 + 0.5) * clamp01((1 - l - 0.333) * 4 + 0.5) * 0.7;
}

export function colorBalanceMidtones(c: RGB, rm: number, gm: number, bm: number): RGB {
  const w = colorBalanceMidtoneWeight(c);
  return [clamp01(c[0] + rm * w), clamp01(c[1] + gm * w), clamp01(c[2] + bm * w)];
}

/**
 * ffmpeg `vibrance` with default balance (1,1,1): saturation-aware boost
 * factor 1 + i·(1 − sign(i)·(max−min)), lerped from the filter's luma.
 */
export function vibranceAdjust(c: RGB, intensity: number): RGB {
  const sat = Math.max(...c) - Math.min(...c);
  const l = luma(c, VIBRANCE_LUMA);
  const f = 1 + intensity * (1 - Math.sign(intensity) * sat);
  return [
    clamp01(l + (c[0] - l) * f),
    clamp01(l + (c[1] - l) * f),
    clamp01(l + (c[2] - l) * f),
  ];
}

export interface LumetriParams {
  exposure: number;
  contrast: number;
  saturation: number;
  temperature: number; // −100..100 (registry range)
  tint: number; // −100..100
  vibrance: number;
}

/**
 * The full Lumetri stage in export-chain order (lumetriArgs):
 * colorchannelmixer(2^exposure) → colorbalance(midtones: rm=+t, gm=−tint,
 * bm=−t, /100) → vibrance → eq(contrast, saturation).
 */
export function lumetriAdjust(c: RGB, p: LumetriParams): RGB {
  const g = Math.pow(2, p.exposure);
  let out: RGB = [clamp01(c[0] * g), clamp01(c[1] * g), clamp01(c[2] * g)];
  const t = p.temperature / 100;
  const ti = p.tint / 100;
  out = colorBalanceMidtones(out, t, -ti, -t);
  out = vibranceAdjust(out, p.vibrance);
  return eqAdjust(out, 0, p.contrast, p.saturation);
}

/**
 * The blend-mode equations shared by vf_blend (on gbrp planes) and the shader,
 * per channel; `b` is the backdrop, `s` the source. ffmpeg's `overlay` mode
 * conditions on its TOP input, which the export graph feeds the backdrop —
 * matching the shader's step on the backdrop.
 */
export function blendChannel(mode: string, b: number, s: number): number {
  switch (mode) {
    case 'multiply':
      return b * s;
    case 'screen':
      return 1 - (1 - b) * (1 - s);
    case 'overlay':
      return b < 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s);
    case 'lighten':
      return Math.max(b, s);
    case 'darken':
      return Math.min(b, s);
    case 'addition':
      return Math.min(b + s, 1);
    case 'difference':
      return Math.abs(b - s);
    default:
      return s; // normal
  }
}
