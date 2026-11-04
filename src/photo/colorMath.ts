// DO NOT EDIT. Copied from media-manipulator-ui lib/photo/colorMath.ts by scripts/sync-photo-fixtures.mjs
// (npm run photo:sync). The web repo is the source of the model and the math (ADR MA-0010);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/**
 * Photo colour math: the NORMATIVE reference for every rung-1 adjustment
 * (design `docs/design/PHOTO_EDITOR.md` §5.1).
 *
 * The WebGL2 preview (`lib/photo/gl/shaders/adjust.glsl`) mirrors these
 * functions stage for stage with the same constant names; the server render
 * (`scripts/server/photo_render.py`, MM96) and the phone (SkSL, MA50) mirror
 * them too. `npm run photo:goldens` renders the shared fixtures through
 * `renderDocCPU` below, so a formula change here must regenerate the goldens
 * deliberately (an equality test pins them).
 *
 * Working values are sRGB-encoded floats in [0,1]; only `exposure` and
 * `whiteBalance` work in linear light. Every stage clamps to [0,1]. Alpha is
 * never touched. Darkroom's formulas (`eqAdjust`, `colorBalanceMidtones`,
 * `vibranceAdjust`) are IMPORTED from `lib/studio/colorMath.ts`, not copied.
 */
import { colorBalanceMidtoneWeight, colorBalanceMidtones, eqAdjust, vibranceAdjust, type RGB } from './studioColorMath';
import { parseCubeLut, type ParsedLut } from './studioLutParser';
import type { AdjustmentLayer, CurvePoint, Geometry, HslRange, LayerOf, LevelsChannel, Mask, MaskComponent, PhotoDoc } from './photoTypes';
import { HSL_RANGE_IDS, defaultHslRanges, isMaskRef } from './photoTypes';

export type { RGB };

/** BT.709 luma weights (same as Darkroom's `EQ_LUMA`). */
export const LUMA: RGB = [0.2126, 0.7152, 0.0722];
/** Hue weight below which HSL range edits fade out so neutrals are untouched. */
export const HSL_NEUTRAL_SAT = 0.1;
export const COLOR_BALANCE_GAIN = 0.3;
export const SPLIT_TONE_GAIN = 0.25;
export const TINT_GAIN = 0.25;
export const LUT_SIZE = 256;
export const MIN_LUMA = 1e-4;

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const luma = (c: RGB): number => c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];

export function smoothstep(e0: number, e1: number, x: number): number {
  if (e1 === e0) return x < e0 ? 0 : 1;
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Transfer functions and colour spaces
// ---------------------------------------------------------------------------

export function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
export function linearToSrgb(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}
const mapRGB = (c: RGB, f: (v: number) => number): RGB => [f(c[0]), f(c[1]), f(c[2])];

/** RGB → [h (0..360), s, l]. */
export function rgbToHsl(c: RGB): [number, number, number] {
  const mx = Math.max(c[0], c[1], c[2]);
  const mn = Math.min(c[0], c[1], c[2]);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (mx === c[0]) h = ((c[1] - c[2]) / d) % 6;
  else if (mx === c[1]) h = (c[2] - c[0]) / d + 2;
  else h = (c[0] - c[1]) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, clamp01(s), l];
}

export function hslToRgb(h: number, s: number, l: number): RGB {
  const hh = (((h % 360) + 360) % 360) / 60;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 1) [r, g, b] = [c, x, 0];
  else if (hh < 2) [r, g, b] = [x, c, 0];
  else if (hh < 3) [r, g, b] = [0, c, x];
  else if (hh < 4) [r, g, b] = [0, x, c];
  else if (hh < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [r + m, g + m, b + m];
}

/** RGB → [h (0..360), s, v] (HSV). */
export function rgbToHsv(c: RGB): [number, number, number] {
  const mx = Math.max(c[0], c[1], c[2]);
  const [h] = rgbToHsl(c);
  return [h, mx === 0 ? 0 : (mx - Math.min(c[0], c[1], c[2])) / mx, mx];
}

/** Fully saturated, full-value colour of a hue in degrees. */
export function hueToRGB(hueDeg: number): RGB {
  const h = (((hueDeg % 360) + 360) % 360) / 360;
  return [clamp01(Math.abs(h * 6 - 3) - 1), clamp01(2 - Math.abs(h * 6 - 2)), clamp01(2 - Math.abs(h * 6 - 4))];
}

/** sRGB → CIE Lab (D65). Used by the MM98 colour-range mask (ΔE76). */
export function rgbToLab(c: RGB): [number, number, number] {
  const [r, g, b] = mapRGB(c, srgbToLinear);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// ---------------------------------------------------------------------------
// Hue ranges
// ---------------------------------------------------------------------------

/**
 * Weight of a hue range at hue `h` (degrees): 1 inside the core
 * (`width` degrees centred on `center`), linear to 0 across `feather` degrees
 * on both sides, circular distance. The six default ranges partition unity.
 */
export function rangeWeight(h: number, center: number, width: number, feather: number): number {
  const d = Math.abs((((h - center) % 360) + 540) % 360 - 180);
  const half = width / 2;
  if (d <= half) return 1;
  if (feather <= 0 || d >= half + feather) return 0;
  return 1 - (d - half) / feather;
}

// ---------------------------------------------------------------------------
// Curves
// ---------------------------------------------------------------------------

/** Fritsch–Carlson monotone cubic Hermite through `points`, sampled to 256 entries. */
export function buildCurveLut(points: CurvePoint[]): Float32Array {
  const n = points.length;
  const lut = new Float32Array(LUT_SIZE);
  if (n < 2) {
    for (let i = 0; i < LUT_SIZE; i += 1) lut[i] = i / (LUT_SIZE - 1);
    return lut;
  }
  const h = new Array<number>(n - 1);
  const d = new Array<number>(n - 1);
  for (let i = 0; i < n - 1; i += 1) {
    h[i] = points[i + 1].x - points[i].x;
    d[i] = (points[i + 1].y - points[i].y) / h[i];
  }
  const m = new Array<number>(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i += 1) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i += 1) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  let seg = 0;
  for (let i = 0; i < LUT_SIZE; i += 1) {
    const x = i / (LUT_SIZE - 1);
    if (x <= points[0].x) {
      lut[i] = points[0].y;
      continue;
    }
    if (x >= points[n - 1].x) {
      lut[i] = points[n - 1].y;
      continue;
    }
    while (seg < n - 2 && x > points[seg + 1].x) seg += 1;
    const t = (x - points[seg].x) / h[seg];
    const t2 = t * t;
    const t3 = t2 * t;
    const y =
      (2 * t3 - 3 * t2 + 1) * points[seg].y +
      (t3 - 2 * t2 + t) * h[seg] * m[seg] +
      (-2 * t3 + 3 * t2) * points[seg + 1].y +
      (t3 - t2) * h[seg] * m[seg + 1];
    lut[i] = clamp01(y);
  }
  return lut;
}

/** Linear interpolation into a 256-entry LUT (what the GPU's LINEAR sampler does). */
export function sampleLut(lut: ArrayLike<number>, v: number): number {
  const p = clamp01(v) * (LUT_SIZE - 1);
  const i = Math.min(LUT_SIZE - 2, Math.floor(p));
  return lerp(lut[i], lut[i + 1], p - i);
}

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

export interface LevelsParams {
  inBlack: number;
  inWhite: number;
  gamma: number;
  outBlack: number;
  outWhite: number;
}

export function levelsChannel(v: number, p: LevelsParams): number {
  const span = Math.max(p.inWhite - p.inBlack, 1e-6);
  const t = clamp01((v - p.inBlack) / span);
  return clamp01(Math.pow(t, 1 / p.gamma) * (p.outWhite - p.outBlack) + p.outBlack);
}

// ---------------------------------------------------------------------------
// Per-type adjustments. Each takes the layer params and returns the new colour.
// ---------------------------------------------------------------------------

type P<K extends AdjustmentLayer['type']> = LayerOf<K>['params'];

export function applyExposure(c: RGB, p: P<'exposure'>): RGB {
  const g = Math.pow(2, p.ev);
  return mapRGB(c, (v) => {
    const lin = clamp01(srgbToLinear(v) * g + p.offset);
    return clamp01(Math.pow(linearToSrgb(lin), 1 / p.gamma));
  });
}

export function applyBrightnessContrast(c: RGB, p: P<'brightnessContrast'>): RGB {
  const k = Math.pow(2, p.contrast / 50);
  return mapRGB(c, (v) => clamp01((clamp01(v + p.brightness / 200) - 0.5) * k + 0.5));
}

export function applyTone(c: RGB, p: P<'tone'>): RGB {
  const L = luma(c);
  const wSh = 1 - smoothstep(0, 0.6, L);
  const wHi = smoothstep(0.4, 1, L);
  const wBl = 1 - smoothstep(0, 0.25, L);
  const wWh = smoothstep(0.75, 1, L);
  const dL =
    0.25 * (p.shadows / 100) * wSh + 0.25 * (p.highlights / 100) * wHi + 0.15 * (p.blacks / 100) * wBl + 0.15 * (p.whites / 100) * wWh;
  const k = clamp01(L + dL) / Math.max(L, MIN_LUMA);
  return mapRGB(c, (v) => clamp01(v * k));
}

export function applyLevels(c: RGB, p: P<'levels'>): RGB {
  const ch = (v: number, k: LevelsChannel) => levelsChannel(v, p[k]);
  return [
    ch(ch(c[0], 'r'), 'master'),
    ch(ch(c[1], 'g'), 'master'),
    ch(ch(c[2], 'b'), 'master'),
  ];
}

export interface CurveLuts {
  master: Float32Array;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
}
export function buildCurveLuts(p: P<'curves'>): CurveLuts {
  return {
    master: buildCurveLut(p.master.points),
    r: buildCurveLut(p.r.points),
    g: buildCurveLut(p.g.points),
    b: buildCurveLut(p.b.points),
  };
}
export function applyCurves(c: RGB, luts: CurveLuts): RGB {
  return [sampleLut(luts.master, sampleLut(luts.r, c[0])), sampleLut(luts.master, sampleLut(luts.g, c[1])), sampleLut(luts.master, sampleLut(luts.b, c[2]))];
}

export function applyWhiteBalance(c: RGB, p: P<'whiteBalance'>): RGB {
  const lin = mapRGB(c, srgbToLinear);
  const t = p.temperature / 100;
  const ti = p.tint / 100;
  return mapRGB(colorBalanceMidtones(lin, t, -ti, -t), (v) => clamp01(linearToSrgb(v)));
}

export function applyVibranceSaturation(c: RGB, p: P<'vibranceSaturation'>): RGB {
  return eqAdjust(vibranceAdjust(c, p.vibrance / 100), 0, 1, 1 + p.saturation / 100);
}

export function applyHsl(c: RGB, p: P<'hsl'>): RGB {
  const [h, s, l] = rgbToHsl(c);
  const neutral = Math.min(1, s / HSL_NEUTRAL_SAT);
  let dh = p.master.hue;
  let sMul = 1 + p.master.saturation / 100;
  const dl = p.master.lightness / 100;
  let lPos = 0;
  let lNeg = 0;
  if (dl > 0) lPos += dl;
  else lNeg += dl;
  for (const r of p.ranges) {
    const w = rangeWeight(h, r.center, r.width, r.feather) * neutral;
    if (w === 0) continue;
    dh += w * r.hue;
    sMul *= 1 + (w * r.saturation) / 100;
    const dlr = (w * r.lightness) / 100;
    if (dlr > 0) lPos += dlr;
    else lNeg += dlr;
  }
  const s2 = clamp01(s * sMul);
  const l2 = clamp01(l + lPos * (1 - l) + lNeg * l);
  const out = hslToRgb(h + dh, s2, l2);
  return [clamp01(out[0]), clamp01(out[1]), clamp01(out[2])];
}

function rescaleToLuma(c: RGB, target: number): RGB {
  const L = luma(c);
  if (L < MIN_LUMA) return c;
  const k = target / L;
  return [clamp01(c[0] * k), clamp01(c[1] * k), clamp01(c[2] * k)];
}

export function applyColorBalance(c: RGB, p: P<'colorBalance'>): RGB {
  const L = luma(c);
  const wSh = 1 - smoothstep(0, 0.5, L);
  const wMid = colorBalanceMidtoneWeight(c);
  const wHi = smoothstep(0.5, 1, L);
  const ch = (k: 'r' | 'g' | 'b') =>
    COLOR_BALANCE_GAIN * ((wSh * p.shadows[k] + wMid * p.midtones[k] + wHi * p.highlights[k]) / 100);
  const out: RGB = [clamp01(c[0] + ch('r')), clamp01(c[1] + ch('g')), clamp01(c[2] + ch('b'))];
  return p.preserveLuminosity ? rescaleToLuma(out, L) : out;
}

const BW_KEYS = ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'] as const;
const BW_RANGES = defaultHslRanges();
export function applyBlackWhite(c: RGB, p: P<'blackWhite'>): RGB {
  const [h, S, V] = rgbToHsv(c);
  const L = luma(c);
  let mix = 0;
  for (let i = 0; i < 6; i += 1) {
    const r = BW_RANGES[i];
    mix += rangeWeight(h, r.center, r.width, r.feather) * (p[BW_KEYS[i]] / 100);
  }
  const gray = clamp01((1 - S) * L + S * mix * V);
  if (!p.tint) return [gray, gray, gray];
  const t = hueToRGB(p.tint.hue);
  const a = (p.tint.saturation / 100) * TINT_GAIN;
  return [clamp01(gray + a * (t[0] - 0.5)), clamp01(gray + a * (t[1] - 0.5)), clamp01(gray + a * (t[2] - 0.5))];
}

export function applyChannelMixer(c: RGB, p: P<'channelMixer'>): RGB {
  const row = (m: { r: number; g: number; b: number; constant: number }) =>
    clamp01((m.r * c[0] + m.g * c[1] + m.b * c[2] + m.constant) / 100);
  const r = row(p.r);
  if (p.monochrome) return [r, r, r];
  return [r, row(p.g), row(p.b)];
}

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function applyPhotoFilter(c: RGB, p: P<'photoFilter'>): RGB {
  const f = hexToRgb(p.color);
  const d = p.density / 100;
  const out: RGB = [lerp(c[0], c[0] * f[0], d), lerp(c[1], c[1] * f[1], d), lerp(c[2], c[2] * f[2], d)];
  return p.preserveLuminosity ? rescaleToLuma(out, luma(c)) : out;
}

export function applySplitTone(c: RGB, p: P<'splitTone'>): RGB {
  const L = luma(c);
  const e = 0.5 + (p.balance / 100) * 0.25;
  const wSh = 1 - smoothstep(0, e, L);
  const wHi = smoothstep(e, 1, L);
  const s = hueToRGB(p.shadows.hue);
  const h = hueToRGB(p.highlights.hue);
  const a = SPLIT_TONE_GAIN * (p.shadows.saturation / 100) * wSh;
  const b = SPLIT_TONE_GAIN * (p.highlights.saturation / 100) * wHi;
  return [0, 1, 2].map((i) => clamp01(c[i] + a * (s[i] - 0.5) + b * (h[i] - 0.5))) as RGB;
}

const lutCache = new Map<string, ParsedLut | null>();
/** Parse (and cache) a `.cube` text; null when it does not parse (layer is a no-op). */
export function parseLutCached(cube: string): ParsedLut | null {
  if (!cube) return null;
  const hit = lutCache.get(cube);
  if (hit !== undefined) return hit;
  let parsed: ParsedLut | null = null;
  try {
    parsed = parseCubeLut(cube);
  } catch {
    parsed = null;
  }
  if (lutCache.size > 8) lutCache.clear();
  lutCache.set(cube, parsed);
  return parsed;
}

/** Trilinear lookup into a byte-quantized cube (red fastest). */
export function sampleLut3D(lut: ParsedLut, c: RGB): RGB {
  const n = lut.size;
  const fx = clamp01(c[0]) * (n - 1);
  const fy = clamp01(c[1]) * (n - 1);
  const fz = clamp01(c[2]) * (n - 1);
  const x0 = Math.min(n - 2, Math.floor(fx));
  const y0 = Math.min(n - 2, Math.floor(fy));
  const z0 = Math.min(n - 2, Math.floor(fz));
  const tx = fx - x0;
  const ty = fy - y0;
  const tz = fz - z0;
  const at = (x: number, y: number, z: number, k: number) => lut.data[((z * n + y) * n + x) * 3 + k] / 255;
  const out: RGB = [0, 0, 0];
  for (let k = 0; k < 3; k += 1) {
    const c00 = lerp(at(x0, y0, z0, k), at(x0 + 1, y0, z0, k), tx);
    const c10 = lerp(at(x0, y0 + 1, z0, k), at(x0 + 1, y0 + 1, z0, k), tx);
    const c01 = lerp(at(x0, y0, z0 + 1, k), at(x0 + 1, y0, z0 + 1, k), tx);
    const c11 = lerp(at(x0, y0 + 1, z0 + 1, k), at(x0 + 1, y0 + 1, z0 + 1, k), tx);
    out[k] = lerp(lerp(c00, c10, ty), lerp(c01, c11, ty), tz);
  }
  return out;
}

export function applyLut(c: RGB, p: P<'lut'>): RGB {
  const lut = parseLutCached(p.cube);
  if (!lut) return c;
  const o = sampleLut3D(lut, c);
  return [lerp(c[0], o[0], p.intensity), lerp(c[1], o[1], p.intensity), lerp(c[2], o[2], p.intensity)];
}

export const applyInvert = (c: RGB): RGB => [1 - c[0], 1 - c[1], 1 - c[2]];
export function applyPosterize(c: RGB, p: P<'posterize'>): RGB {
  const n = p.levels - 1;
  return mapRGB(c, (v) => Math.floor(clamp01(v) * n + 0.5) / n);
}
export function applyThreshold(c: RGB, p: P<'threshold'>): RGB {
  const v = luma(c) >= p.level ? 1 : 0;
  return [v, v, v];
}
export function applyGamma(c: RGB, p: P<'gamma'>): RGB {
  return mapRGB(c, (v) => clamp01(Math.pow(clamp01(v), 1 / p.gamma)));
}

// ---------------------------------------------------------------------------
// Layer stack
// ---------------------------------------------------------------------------

/** Per-document precomputation (curve LUTs) reused for every pixel. */
export interface LayerPlan {
  layer: AdjustmentLayer;
  curves?: CurveLuts;
}
export function planLayers(doc: Pick<PhotoDoc, 'layers'>): LayerPlan[] {
  return doc.layers
    .filter((l) => l.enabled && l.opacity > 0)
    .map((layer) => ({ layer, curves: layer.type === 'curves' ? buildCurveLuts(layer.params) : undefined }));
}

export function applyLayerType(c: RGB, plan: LayerPlan): RGB {
  const l = plan.layer;
  switch (l.type) {
    case 'exposure':
      return applyExposure(c, l.params);
    case 'brightnessContrast':
      return applyBrightnessContrast(c, l.params);
    case 'tone':
      return applyTone(c, l.params);
    case 'levels':
      return applyLevels(c, l.params);
    case 'curves':
      return applyCurves(c, plan.curves as CurveLuts);
    case 'whiteBalance':
      return applyWhiteBalance(c, l.params);
    case 'vibranceSaturation':
      return applyVibranceSaturation(c, l.params);
    case 'hsl':
      return applyHsl(c, l.params);
    case 'colorBalance':
      return applyColorBalance(c, l.params);
    case 'blackWhite':
      return applyBlackWhite(c, l.params);
    case 'channelMixer':
      return applyChannelMixer(c, l.params);
    case 'photoFilter':
      return applyPhotoFilter(c, l.params);
    case 'splitTone':
      return applySplitTone(c, l.params);
    case 'lut':
      return applyLut(c, l.params);
    case 'invert':
      return applyInvert(c);
    case 'posterize':
      return applyPosterize(c, l.params);
    case 'threshold':
      return applyThreshold(c, l.params);
    case 'gamma':
      return applyGamma(c, l.params);
    case 'redEye':
      return [Math.min(c[0], (c[1] + c[2]) / 2), c[1], c[2]];
    default:
      // Rung-4 detail ops (MM99) are neighbourhood ops (applyDetailCPU): identity per pixel.
      return c;
  }
}

/**
 * Blend an adjusted colour onto the input: `normal` replaces, `luminosity`
 * keeps the input's hue/chroma and takes the adjusted luma (shift), `color`
 * keeps the input's luma and takes the adjusted chroma (shift).
 */
export function blendLayer(mode: AdjustmentLayer['blend'], input: RGB, adjusted: RGB): RGB {
  if (mode === 'normal') return adjusted;
  const d = mode === 'luminosity' ? luma(adjusted) - luma(input) : luma(input) - luma(adjusted);
  const base = mode === 'luminosity' ? input : adjusted;
  return [clamp01(base[0] + d), clamp01(base[1] + d), clamp01(base[2] + d)];
}

/** Blend + opacity/mask step shared by per-pixel layers and the whole-image detail layers (MM99). */
export function mixLayer(c: RGB, layer: AdjustmentLayer, adjustedRaw: RGB, maskValue = 1): RGB {
  const adjusted = blendLayer(layer.blend, c, adjustedRaw);
  const a = clamp01(layer.opacity * maskValue);
  if (a >= 1) return adjusted;
  return [lerp(c[0], adjusted[0], a), lerp(c[1], adjusted[1], a), lerp(c[2], adjusted[2], a)];
}

export function applyLayer(c: RGB, plan: LayerPlan, maskValue = 1): RGB {
  return mixLayer(c, plan.layer, applyLayerType(c, plan), maskValue);
}

// ---------------------------------------------------------------------------
// Masks (design §5.2, MM98). Conventions are pinned in
// `.scratch/mm96-mm98/NOTES.md` "Mask and geometry math as implemented".
// ---------------------------------------------------------------------------

export type MaskMode = 'add' | 'subtract' | 'intersect';
/** Fold component values left to right: add = max, subtract = min(m, 1-c), intersect = min. Starts at 0. */
export function foldMask(parts: { mode: MaskMode; value: number }[]): number {
  let m = 0;
  for (const { mode, value } of parts) {
    if (mode === 'add') m = Math.max(m, value);
    else if (mode === 'subtract') m = Math.min(m, 1 - value);
    else m = Math.min(m, value);
  }
  return m;
}
/** After the feather blur: invert, then scale by the mask opacity, clamped. */
export function finishMask(m: number, invert: boolean, opacity: number): number {
  return clamp01((invert ? 1 - m : m) * opacity);
}

/** Max ΔE76 radius (Lab units) at fuzziness 100. */
export const COLOR_RANGE_MAX_DE = 60;
/** Feather σ is `feather/100 * MASK_FEATHER_SIGMA * longSide` pixels. */
export const MASK_FEATHER_SIGMA = 0.05;

const mmin = (a: number, b: number) => (a < b ? a : b);

/**
 * Linear gradient: pixel-space projection `t` of the point on the line
 * from→to (0 at `from`, 1 at `to`), value `smoothstep(-f, 1+f, t)`.
 * Degenerate lines (from == to) give 0.
 */
export function gradientValue(c: Extract<MaskComponent, { kind: 'gradient' }>, px: number, py: number, w: number, h: number): number {
  const fx = c.from.x * w;
  const fy = c.from.y * h;
  const dx = c.to.x * w - fx;
  const dy = c.to.y * h - fy;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return 0;
  const t = ((px - fx) * dx + (py - fy) * dy) / len2;
  return smoothstep(-c.feather, 1 + c.feather, t);
}

/**
 * Radial: ellipse with semi-axes `rx*w`, `ry*h` pixels, rotated `rotate`
 * degrees clockwise (y down) about `center`. `d` = elliptic radius;
 * value `1 - smoothstep(1-f, 1, d)` (1 inside `1-f`, 0 at the rim).
 */
export function radialValue(c: Extract<MaskComponent, { kind: 'radial' }>, px: number, py: number, w: number, h: number): number {
  const [cs, sn] = trig(c.rotate);
  const dx = px - c.center.x * w;
  const dy = py - c.center.y * h;
  const u = dx * cs + dy * sn; // inverse rotation
  const v = -dx * sn + dy * cs;
  const rx = Math.max(c.rx * w, 1e-6);
  const ry = Math.max(c.ry * h, 1e-6);
  const d = Math.sqrt((u / rx) * (u / rx) + (v / ry) * (v / ry));
  return 1 - smoothstep(1 - c.feather, 1, d);
}

/** `smoothstep(lo-f, lo, L) * (1 - smoothstep(hi, hi+f, L))`. */
export function luminosityValue(c: Extract<MaskComponent, { kind: 'luminosity' }>, L: number): number {
  return smoothstep(c.lo - c.feather, c.lo, L) * (1 - smoothstep(c.hi, c.hi + c.feather, L));
}

/** `1 - smoothstep(0.5R, R, ΔE76)` with `R = fuzziness/100 * 60`, max over the targets (none = 0). */
export function colorRangeValue(c: Extract<MaskComponent, { kind: 'colorRange' }>, src: RGB): number {
  if (c.colors.length === 0) return 0;
  const R = (c.fuzziness / 100) * COLOR_RANGE_MAX_DE;
  const lab = rgbToLab(src);
  let best = 0;
  for (const t of c.colors) {
    const tl = rgbToLab([t.r / 255, t.g / 255, t.b / 255]);
    const de = Math.hypot(lab[0] - tl[0], lab[1] - tl[1], lab[2] - tl[2]);
    best = Math.max(best, 1 - smoothstep(0.5 * R, R, de));
  }
  return best;
}

/** An 8-bit alpha raster (brush or subject mask) covering the whole mask space. */
export interface AlphaImage {
  width: number;
  height: number;
  alpha: ArrayLike<number>;
}
/** Where the brush PNG and the subject mask pixels come from (the caller decodes). */
export interface MaskAssets {
  brush?: (png: string) => AlphaImage | null;
  subject?: (maskRef: string) => AlphaImage | null;
}

/** Bilinear sample of an alpha raster at normalized (nx, ny): texel centres at +0.5, edge clamped. */
export function sampleAlpha(img: AlphaImage, nx: number, ny: number): number {
  const u = nx * img.width - 0.5;
  const v = ny * img.height - 0.5;
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const tx = u - x0;
  const ty = v - y0;
  const cx = (x: number) => (x < 0 ? 0 : x >= img.width ? img.width - 1 : x);
  const cy = (y: number) => (y < 0 ? 0 : y >= img.height ? img.height - 1 : y);
  const at = (x: number, y: number) => img.alpha[cy(y) * img.width + cx(x)] / 255;
  return lerp(lerp(at(x0, y0), at(x0 + 1, y0), tx), lerp(at(x0, y0 + 1), at(x0 + 1, y0 + 1), tx), ty);
}

/** Normalised 1-D Gaussian taps for σ (radius ceil(3σ)); empty when σ < 1e-3 (no blur). */
export function gaussianTaps(sigma: number): Float32Array {
  if (sigma < 1e-3) return new Float32Array([1]);
  const r = Math.ceil(3 * sigma);
  const taps = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let k = -r; k <= r; k += 1) {
    const v = Math.exp(-(k * k) / (2 * sigma * sigma));
    taps[k + r] = v;
    sum += v;
  }
  for (let i = 0; i < taps.length; i += 1) taps[i] /= sum;
  return taps;
}

/** Separable Gaussian blur of a single-channel image, edge pixels replicated. */
export function blurMask(m: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const taps = gaussianTaps(sigma);
  if (taps.length === 1) return m;
  const r = (taps.length - 1) / 2;
  const tmp = new Float32Array(m.length);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let acc = 0;
      for (let k = -r; k <= r; k += 1) {
        const xx = x + k < 0 ? 0 : x + k >= w ? w - 1 : x + k;
        acc += taps[k + r] * m[y * w + xx];
      }
      tmp[y * w + x] = acc;
    }
  }
  const out = new Float32Array(m.length);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let acc = 0;
      for (let k = -r; k <= r; k += 1) {
        const yy = y + k < 0 ? 0 : y + k >= h ? h - 1 : y + k;
        acc += taps[k + r] * tmp[yy * w + x];
      }
      out[y * w + x] = acc;
    }
  }
  return out;
}

/** Feather σ in pixels for a mask feather (0..100) on a `w`×`h` mask space. */
export const featherSigma = (feather: number, w: number, h: number): number => (feather / 100) * MASK_FEATHER_SIGMA * Math.max(w, h);

/**
 * The full mask raster (w*h values in [0,1]) for `image`, the
 * geometry-corrected source (luminosity and colour range read it; they never
 * see earlier layers, so a mask depends only on the source and its own
 * components). Order: fold → feather blur → invert → opacity. A component
 * whose asset is unavailable (no decoded brush/subject) is skipped.
 */
export function renderMaskCPU(mask: Mask, image: FloatImage, assets: MaskAssets = {}): Float32Array {
  const { width: w, height: h } = image;
  const folded = new Float32Array(w * h);
  const brush: (AlphaImage | null)[] = mask.components.map((c) => (c.kind === 'brush' ? assets.brush?.(c.png) ?? null : c.kind === 'subject' ? assets.subject?.(c.maskRef) ?? null : null));
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const px = x + 0.5;
      const py = y + 0.5;
      let m = 0;
      for (let k = 0; k < mask.components.length; k += 1) {
        const c = mask.components[k];
        let v: number;
        switch (c.kind) {
          case 'gradient':
            v = gradientValue(c, px, py, w, h);
            break;
          case 'radial':
            v = radialValue(c, px, py, w, h);
            break;
          case 'brush': {
            const a = brush[k];
            if (!a) continue;
            v = sampleAlpha(a, px / w, py / h);
            break;
          }
          case 'subject': {
            const a = brush[k];
            if (!a) continue;
            v = sampleAlpha(a, px / w, py / h);
            if (c.invert) v = 1 - v;
            break;
          }
          case 'luminosity':
            v = luminosityValue(c, luma([image.data[i * 4], image.data[i * 4 + 1], image.data[i * 4 + 2]]));
            break;
          default:
            v = colorRangeValue(c, [image.data[i * 4], image.data[i * 4 + 1], image.data[i * 4 + 2]]);
            break;
        }
        if (c.mode === 'add') m = Math.max(m, v);
        else if (c.mode === 'subtract') m = mmin(m, 1 - v);
        else m = mmin(m, v);
      }
      folded[i] = m;
    }
  }
  const blurred = mask.feather > 0 ? blurMask(folded, w, h, featherSigma(mask.feather, w, h)) : folded;
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i += 1) out[i] = finishMask(blurred[i], mask.invert, mask.opacity);
  return out;
}

/** A layer's effective mask: inline, resolved from `doc.masks`, or null (unmasked; unknown refs too). */
export function resolveLayerMask(doc: Pick<PhotoDoc, 'masks'>, layer: Pick<AdjustmentLayer, 'mask'>): Mask | null {
  const m = layer.mask;
  if (!m) return null;
  if (isMaskRef(m)) return doc.masks?.[m.ref] ?? null;
  return m;
}

// ---------------------------------------------------------------------------
// Geometry (design §5.3, MM98)
// ---------------------------------------------------------------------------

/** cos/sin of an angle in degrees, exact for multiples of 90. */
export function trig(deg: number): [number, number] {
  const r = (deg * Math.PI) / 180;
  const snap = (v: number) => (Math.abs(v) < 1e-12 ? 0 : Math.abs(Math.abs(v) - 1) < 1e-12 ? Math.sign(v) : v);
  return [snap(Math.cos(r)), snap(Math.sin(r))];
}

/**
 * Unit square → quad projective map (Heckbert). Corners tl, tr, br, bl of the
 * unit square go to `q[0..3]`. Returns [a,b,c,d,e,f,g,h]:
 * x = (a u + b v + c) / (g u + h v + 1), y = (d u + e v + f) / (g u + h v + 1).
 */
export function unitSquareToQuad(q: [number, number][]): number[] {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;
  if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) return [x1 - x0, x3 - x0, x0, y1 - y0, y3 - y0, y0, 0, 0];
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den;
  const hh = (dx1 * sy - sx * dy1) / den;
  return [x1 - x0 + g * x1, x3 - x0 + hh * x3, x0, y1 - y0 + g * y1, y3 - y0 + hh * y3, y0, g, hh];
}

export interface GeometryPlan {
  /** Source size. */
  w0: number;
  h0: number;
  /** Post-rotate canvas size (grown to the rotated bounding box). */
  wr: number;
  hr: number;
  /** Crop origin and output size, pixels of the canvas. */
  ox: number;
  oy: number;
  wo: number;
  ho: number;
  cos: number;
  sin: number;
  flipH: boolean;
  flipV: boolean;
  /** Unit-square→quad homography in canvas-normalized coords, or null. */
  persp: number[] | null;
  fill: 'transparent' | 'edge' | RGB;
}

const isIdentityGeometry = (g: Geometry): boolean =>
  g.rotate === 0 && !g.flipH && !g.flipV && !g.perspective && !g.crop;

export function planGeometry(g: Geometry, w0: number, h0: number): GeometryPlan {
  const [cos, sin] = trig(g.rotate);
  const wr = Math.max(1, Math.round(Math.abs(w0 * cos) + Math.abs(h0 * sin) - 1e-9));
  const hr = Math.max(1, Math.round(Math.abs(w0 * sin) + Math.abs(h0 * cos) - 1e-9));
  let ox = 0;
  let oy = 0;
  let wo = wr;
  let ho = hr;
  if (g.crop) {
    ox = Math.min(wr - 1, Math.round(g.crop.x * wr));
    oy = Math.min(hr - 1, Math.round(g.crop.y * hr));
    wo = Math.max(1, Math.min(wr - ox, Math.round(g.crop.width * wr)));
    ho = Math.max(1, Math.min(hr - oy, Math.round(g.crop.height * hr)));
  }
  let persp: number[] | null = null;
  if (g.perspective) {
    const p = g.perspective;
    persp = unitSquareToQuad([
      [p.tl.x, p.tl.y],
      [1 + p.tr.x, p.tr.y],
      [1 + p.br.x, 1 + p.br.y],
      [p.bl.x, 1 + p.bl.y],
    ]);
  }
  const fill = g.fill === 'transparent' || g.fill === 'edge' ? g.fill : hexToRgb(g.fill);
  return { w0, h0, wr, hr, ox, oy, wo, ho, cos, sin, flipH: g.flipH, flipV: g.flipV, persp, fill };
}

/**
 * Source-pixel coordinates (continuous, texel edges at integers) for the
 * centre of output pixel (i, j): crop → perspective → flip → rotate, inverse.
 */
export function geometrySourcePoint(p: GeometryPlan, i: number, j: number): [number, number] {
  let qx = p.ox + i + 0.5;
  let qy = p.oy + j + 0.5;
  if (p.persp) {
    const [a, b, c, d, e, f, g, h] = p.persp;
    const u = qx / p.wr;
    const v = qy / p.hr;
    const den = g * u + h * v + 1;
    qx = ((a * u + b * v + c) / den) * p.wr;
    qy = ((d * u + e * v + f) / den) * p.hr;
  }
  if (p.flipH) qx = p.wr - qx;
  if (p.flipV) qy = p.hr - qy;
  const dx = qx - p.wr / 2;
  const dy = qy - p.hr / 2;
  return [p.w0 / 2 + dx * p.cos + dy * p.sin, p.h0 / 2 - dx * p.sin + dy * p.cos];
}

/**
 * Apply `doc.geometry` to a float image: one inverse-mapped bilinear resample
 * (identity geometry returns the input). Points outside the source rectangle
 * take the fill (`transparent` = RGBA 0, `#rrggbb` = opaque colour, `edge` =
 * the clamped edge texel). Alpha is interpolated like colour.
 */
export function applyGeometryCPU(image: FloatImage, g: Geometry): FloatImage {
  if (isIdentityGeometry(g)) return image;
  const p = planGeometry(g, image.width, image.height);
  const out = new Float32Array(p.wo * p.ho * 4);
  const { width: w, height: h, data } = image;
  for (let j = 0; j < p.ho; j += 1) {
    for (let i = 0; i < p.wo; i += 1) {
      const [sx, sy] = geometrySourcePoint(p, i, j);
      const o = (j * p.wo + i) * 4;
      const inside = sx >= 0 && sx <= w && sy >= 0 && sy <= h;
      if (!inside && p.fill !== 'edge') {
        if (p.fill !== 'transparent') {
          out[o] = p.fill[0];
          out[o + 1] = p.fill[1];
          out[o + 2] = p.fill[2];
          out[o + 3] = 1;
        }
        continue;
      }
      const u = sx - 0.5;
      const v = sy - 0.5;
      const x0 = Math.floor(u);
      const y0 = Math.floor(v);
      const tx = u - x0;
      const ty = v - y0;
      const cx = (x: number) => (x < 0 ? 0 : x >= w ? w - 1 : x);
      const cy = (y: number) => (y < 0 ? 0 : y >= h ? h - 1 : y);
      const xa = cx(x0);
      const xb = cx(x0 + 1);
      const ya = cy(y0);
      const yb = cy(y0 + 1);
      for (let k = 0; k < 4; k += 1) {
        const top = lerp(data[(ya * w + xa) * 4 + k], data[(ya * w + xb) * 4 + k], tx);
        const bot = lerp(data[(yb * w + xa) * 4 + k], data[(yb * w + xb) * 4 + k], tx);
        out[o + k] = lerp(top, bot, ty);
      }
    }
  }
  return { width: p.wo, height: p.ho, data: out };
}

/** Output (geometry-corrected) size for a source size. */
export function geometryOutputSize(g: Geometry, w0: number, h0: number): { width: number; height: number } {
  const p = planGeometry(g, w0, h0);
  return { width: p.wo, height: p.ho };
}

/**
 * Largest centred crop (normalized to the post-rotate canvas, same aspect as
 * the canvas unless `aspect` is given as w/h pixels) whose perimeter samples
 * all land inside the source: the "auto-crop" for straighten and perspective.
 * Binary search on the scale; null crop when nothing smaller is needed.
 */
export function autoCropRect(g: Geometry, w0: number, h0: number, aspect?: number): { x: number; y: number; width: number; height: number } {
  const base = planGeometry({ ...g, crop: null }, w0, h0);
  const asp = aspect ?? base.wr / base.hr;
  // max normalized size with this aspect inside the canvas
  const maxW = Math.min(1, (asp * base.hr) / base.wr);
  const maxH = (maxW * base.wr) / asp / base.hr;
  const valid = (s: number): boolean => {
    const cw = maxW * s;
    const ch = maxH * s;
    const x0 = (1 - cw) / 2;
    const y0 = (1 - ch) / 2;
    const N = 24;
    for (let k = 0; k <= N; k += 1) {
      const t = k / N;
      const pts: [number, number][] = [
        [x0 + cw * t, y0],
        [x0 + cw * t, y0 + ch],
        [x0, y0 + ch * t],
        [x0 + cw, y0 + ch * t],
      ];
      for (const [nx, ny] of pts) {
        const [sx, sy] = geometrySourcePoint({ ...base, ox: 0, oy: 0 }, nx * base.wr - 0.5, ny * base.hr - 0.5);
        if (sx < 0 || sx > w0 || sy < 0 || sy > h0) return false;
      }
    }
    return true;
  };
  let lo = 0;
  let hi = 1;
  if (valid(1)) lo = 1;
  else for (let it = 0; it < 30; it += 1) {
    const mid = (lo + hi) / 2;
    if (valid(mid)) lo = mid;
    else hi = mid;
  }
  const cw = maxW * lo;
  const ch = maxH * lo;
  return { x: (1 - cw) / 2, y: (1 - ch) / 2, width: cw, height: ch };
}

// ---------------------------------------------------------------------------
// Detail (design §5.4, MM99). Whole-image ops on interleaved float64 RGB
// (`px * 3`). Conventions pinned here (the design table leaves them open) and
// mirrored by `scripts/server/photo_render.py` and `gl/shaders/detailSource.ts`:
// - Gaussian: taps k = -r..r, r = ceil(3σ), exp(-k²/2σ²) normalised in float64,
//   edge pixels replicated, separable (horizontal then vertical); σ < 1e-3 = identity.
// - Unsharp (sharpen, clarity, texture): d = L - gauss(L, σ) with L = BT.709 luma
//   of the input; shift = gain·d·W added to R, G and B, then clamped.
// - Bilateral (noise reduction luminance): fixed 9×9 window (radius 4), edges
//   replicated, spatial σs = 2 + l·6, range σr = max(l·0.2, 1e-3) on Lab L/100.
// - Dehaze: dark channel = 15×15 min of min(r,g,b), window clipped at the edges;
//   A = max(linear 99.5th percentile of the dark channel, 0.05).
// - Grain: monochrome; the 32-bit PCG hash below; pixel coordinates of the
//   image being rendered (not scaled by resolution).
// ---------------------------------------------------------------------------

export const DETAIL_LAYER_TYPES = ['sharpen', 'blur', 'noiseReduction', 'clarity', 'texture', 'dehaze', 'vignette', 'grain'] as const;
export type DetailLayerType = (typeof DETAIL_LAYER_TYPES)[number];
export const isDetailType = (t: string): t is DetailLayerType => (DETAIL_LAYER_TYPES as readonly string[]).includes(t);

export const CLARITY_RADIUS = 0.02; // fraction of the long side
export const CLARITY_GAIN = 0.6;
export const TEXTURE_RADIUS = 0.003;
export const TEXTURE_MIN_RADIUS = 1.5;
export const TEXTURE_GAIN = 0.5;
export const BILATERAL_RADIUS = 4;
export const NR_CHROMA_SIGMA = 6;
export const DEHAZE_WINDOW_RADIUS = 7;
export const DEHAZE_OMEGA = 0.95;
export const DEHAZE_PERCENTILE = 0.995;
export const DEHAZE_MIN_A = 0.05;
export const DEHAZE_MIN_T = 0.1;
export const DEHAZE_HAZE_GAIN = 0.5;
export const GRAIN_GAIN = 0.2;
export const GRAIN_Y_OFFSET = 0x9e3779b9;
export const GRAIN_SALT = 0x85ebca6b;
export const GRAIN_ROUGHNESS_MIX = 0.5;

/** Normalised float64 Gaussian taps (`gaussianTaps` is float32 for the mask path). */
export function gaussianTaps64(sigma: number): Float64Array {
  if (sigma < 1e-3) return new Float64Array([1]);
  const r = Math.ceil(3 * sigma);
  const taps = new Float64Array(2 * r + 1);
  let sum = 0;
  for (let k = -r; k <= r; k += 1) {
    const v = Math.exp(-(k * k) / (2 * sigma * sigma));
    taps[k + r] = v;
    sum += v;
  }
  for (let i = 0; i < taps.length; i += 1) taps[i] /= sum;
  return taps;
}

/** Separable Gaussian of `ch` interleaved channels, edge pixels replicated. */
export function gaussBlurPlanes(src: Float64Array, w: number, h: number, ch: number, sigma: number): Float64Array {
  const taps = gaussianTaps64(sigma);
  if (taps.length === 1) return src;
  const r = (taps.length - 1) / 2;
  const tmp = new Float64Array(src.length);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      for (let c = 0; c < ch; c += 1) {
        let acc = 0;
        for (let k = -r; k <= r; k += 1) {
          const xx = x + k < 0 ? 0 : x + k >= w ? w - 1 : x + k;
          acc += taps[k + r] * src[(y * w + xx) * ch + c];
        }
        tmp[(y * w + x) * ch + c] = acc;
      }
    }
  }
  const out = new Float64Array(src.length);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      for (let c = 0; c < ch; c += 1) {
        let acc = 0;
        for (let k = -r; k <= r; k += 1) {
          const yy = y + k < 0 ? 0 : y + k >= h ? h - 1 : y + k;
          acc += taps[k + r] * tmp[(yy * w + x) * ch + c];
        }
        out[(y * w + x) * ch + c] = acc;
      }
    }
  }
  return out;
}

function lumaPlane(rgb: Float64Array, px: number): Float64Array {
  const L = new Float64Array(px);
  for (let i = 0; i < px; i += 1) L[i] = rgb[i * 3] * LUMA[0] + rgb[i * 3 + 1] * LUMA[1] + rgb[i * 3 + 2] * LUMA[2];
  return L;
}

/** Unsharp mask on luma: `gain·(L - gauss(L, σ))·W` added to every channel; `thr` in 0..1; W = 1-|2L-1| when `midWeight`. */
export function unsharpLuma(rgb: Float64Array, w: number, h: number, sigma: number, gain: number, midWeight: boolean, thr = 0): Float64Array {
  const px = w * h;
  const L = lumaPlane(rgb, px);
  const Lb = gaussBlurPlanes(L, w, h, 1, sigma);
  const out = new Float64Array(rgb.length);
  for (let i = 0; i < px; i += 1) {
    let d = L[i] - Lb[i];
    if (thr > 0 && !(Math.abs(d) > thr)) d = 0;
    const wt = midWeight ? 1 - Math.abs(2 * L[i] - 1) : 1;
    const shift = gain * d * wt;
    out[i * 3] = clamp01(rgb[i * 3] + shift);
    out[i * 3 + 1] = clamp01(rgb[i * 3 + 1] + shift);
    out[i * 3 + 2] = clamp01(rgb[i * 3 + 2] + shift);
  }
  return out;
}

/** CIE Lab (D65) → sRGB, clamped. Inverse of `rgbToLab` (standard inverse matrix constants). */
export function labToRgb(L: number, a: number, b: number): RGB {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const finv = (f: number) => (f > 6 / 29 ? f * f * f : ((116 * f - 16) * 27) / 24389);
  const x = finv(fx) * 0.95047;
  const y = finv(fy);
  const z = finv(fz) * 1.08883;
  const r = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const g = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  const bl = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  return [clamp01(linearToSrgb(clamp01(r))), clamp01(linearToSrgb(clamp01(g))), clamp01(linearToSrgb(clamp01(bl)))];
}

/** 9×9 bilateral of a single plane (values in 0..1), edges replicated. */
export function bilateral9(plane: Float64Array, w: number, h: number, sigmaS: number, sigmaR: number): Float64Array {
  const R = BILATERAL_RADIUS;
  const spatial = new Float64Array((2 * R + 1) * (2 * R + 1));
  for (let dy = -R; dy <= R; dy += 1) for (let dx = -R; dx <= R; dx += 1) spatial[(dy + R) * (2 * R + 1) + dx + R] = Math.exp(-(dx * dx + dy * dy) / (2 * sigmaS * sigmaS));
  const out = new Float64Array(plane.length);
  const inv2r = 1 / (2 * sigmaR * sigmaR);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = plane[y * w + x];
      let acc = 0;
      let ws = 0;
      for (let dy = -R; dy <= R; dy += 1) {
        const yy = y + dy < 0 ? 0 : y + dy >= h ? h - 1 : y + dy;
        for (let dx = -R; dx <= R; dx += 1) {
          const xx = x + dx < 0 ? 0 : x + dx >= w ? w - 1 : x + dx;
          const q = plane[yy * w + xx];
          const wt = spatial[(dy + R) * (2 * R + 1) + dx + R] * Math.exp(-(q - p) * (q - p) * inv2r);
          acc += wt * q;
          ws += wt;
        }
      }
      out[y * w + x] = acc / ws;
    }
  }
  return out;
}

export function noiseReduction(rgb: Float64Array, w: number, h: number, p: P<'noiseReduction'>): Float64Array {
  if (p.luminance <= 0 && p.color <= 0) return rgb;
  const px = w * h;
  const lab = new Float64Array(px * 3);
  for (let i = 0; i < px; i += 1) {
    const [L, a, b] = rgbToLab([rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]]);
    lab[i * 3] = L;
    lab[i * 3 + 1] = a;
    lab[i * 3 + 2] = b;
  }
  let Lp: Float64Array = new Float64Array(px);
  for (let i = 0; i < px; i += 1) Lp[i] = lab[i * 3] / 100;
  if (p.luminance > 0) {
    const l = p.luminance / 100;
    Lp = bilateral9(Lp, w, h, 2 + l * 6, Math.max(l * 0.2, 1e-3));
  }
  let ab: Float64Array = new Float64Array(px * 2);
  for (let i = 0; i < px; i += 1) {
    ab[i * 2] = lab[i * 3 + 1];
    ab[i * 2 + 1] = lab[i * 3 + 2];
  }
  if (p.color > 0) ab = gaussBlurPlanes(ab, w, h, 2, (p.color / 100) * NR_CHROMA_SIGMA);
  const out = new Float64Array(px * 3);
  for (let i = 0; i < px; i += 1) {
    const c = labToRgb(Lp[i] * 100, ab[i * 2], ab[i * 2 + 1]);
    out[i * 3] = c[0];
    out[i * 3 + 1] = c[1];
    out[i * 3 + 2] = c[2];
  }
  return out;
}

/** Clipped-window min of a single plane over a (2r+1)² box (separable). */
export function minFilter(plane: Float64Array, w: number, h: number, r: number): Float64Array {
  const tmp = new Float64Array(plane.length);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let m = Infinity;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k += 1) m = Math.min(m, plane[y * w + k]);
      tmp[y * w + x] = m;
    }
  }
  const out = new Float64Array(plane.length);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let m = Infinity;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k += 1) m = Math.min(m, tmp[k * w + x]);
      out[y * w + x] = m;
    }
  }
  return out;
}

/** Linear-interpolated percentile (q in 0..1) like `numpy.percentile(·, 100q)`. */
export function percentile(values: ArrayLike<number>, q: number): number {
  const s = Float64Array.from(values as ArrayLike<number>).sort();
  if (s.length === 0) return 0;
  const pos = q * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, s.length - 1);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Atmospheric light from a dark-channel plane. */
export const dehazeLight = (dark: ArrayLike<number>): number => Math.max(percentile(dark, DEHAZE_PERCENTILE), DEHAZE_MIN_A);

/** Dark channel: window min of min(r,g,b). */
export function darkChannel(rgb: Float64Array, w: number, h: number): Float64Array {
  const m = new Float64Array(w * h);
  for (let i = 0; i < m.length; i += 1) m[i] = Math.min(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
  return minFilter(m, w, h, DEHAZE_WINDOW_RADIUS);
}

/** Dehaze one pixel given its dark-channel value `d` and the light `A`. */
export function dehazePixel(c: RGB, d: number, A: number, amount: number): RGB {
  const amt = amount / 100;
  if (amt === 0) return c;
  if (amt > 0) {
    const t = Math.max(1 - DEHAZE_OMEGA * (d / A), DEHAZE_MIN_T);
    return [0, 1, 2].map((i) => c[i] + (clamp01((c[i] - A) / t + A) - c[i]) * amt) as RGB;
  }
  const k = -amt * DEHAZE_HAZE_GAIN;
  return [0, 1, 2].map((i) => clamp01(c[i] * (1 - k) + A * k)) as RGB;
}

export function dehaze(rgb: Float64Array, w: number, h: number, p: P<'dehaze'>): Float64Array {
  if (p.amount === 0) return rgb;
  const dark = darkChannel(rgb, w, h);
  const A = dehazeLight(dark);
  const out = new Float64Array(rgb.length);
  for (let i = 0; i < w * h; i += 1) {
    const c = dehazePixel([rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]], dark[i], A, p.amount);
    out[i * 3] = c[0];
    out[i * 3 + 1] = c[1];
    out[i * 3 + 2] = c[2];
  }
  return out;
}

/**
 * Vignette frame distance: 0 at the centre, 1 at the corners for every
 * roundness. `nx`, `ny` in -1..1 (image rectangle); `roundness` -100..100 mixes
 * the rectangle metric (max(|nx|,|ny|)) with the circle metric (distance over
 * the half diagonal) with weight (roundness + 100)/200 on the circle.
 */
export function vignetteDistance(nx: number, ny: number, w: number, h: number, roundness: number): number {
  const rect = Math.max(Math.abs(nx), Math.abs(ny));
  const circ = Math.hypot((nx * w) / 2, (ny * h) / 2) / Math.hypot(w / 2, h / 2);
  const r = (roundness + 100) / 200;
  return rect * (1 - r) + circ * r;
}

/** Vignette factor `v` in 0..1 (the smoothstep of the frame distance). */
export const vignetteFactor = (d: number, midpoint: number, feather: number): number => smoothstep(midpoint / 100, midpoint / 100 + feather / 100, d);

export function vignette(rgb: Float64Array, w: number, h: number, p: P<'vignette'>): Float64Array {
  const out = new Float64Array(rgb.length);
  const amt = p.amount / 100;
  for (let y = 0; y < h; y += 1) {
    const ny = ((y + 0.5) / h) * 2 - 1;
    for (let x = 0; x < w; x += 1) {
      const nx = ((x + 0.5) / w) * 2 - 1;
      const i = y * w + x;
      const v = vignetteFactor(vignetteDistance(nx, ny, w, h, p.roundness), p.midpoint, p.feather);
      const L = rgb[i * 3] * LUMA[0] + rgb[i * 3 + 1] * LUMA[1] + rgb[i * 3 + 2] * LUMA[2];
      const prot = amt < 0 ? 1 - (p.highlights / 100) * L : 1;
      const k = 1 + amt * v * prot;
      out[i * 3] = clamp01(rgb[i * 3] * k);
      out[i * 3 + 1] = clamp01(rgb[i * 3 + 1] * k);
      out[i * 3 + 2] = clamp01(rgb[i * 3 + 2] * k);
    }
  }
  return out;
}

/** PCG output hash of a 32-bit word (Jarzynski/Olano): the only integer primitive of the grain. */
export function pcgHash(v: number): number {
  const s = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const word = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}

/** Grain hash of integer cell (x, y) and a seed, a uint32: `pcg(pcg(x ^ seed) ^ (y + 0x9E3779B9))`. */
export function grainHash(x: number, y: number, seed: number): number {
  return pcgHash((pcgHash((x ^ seed) >>> 0) ^ ((y + GRAIN_Y_OFFSET) >>> 0)) >>> 0);
}

/** Noise value in [0,1) for pixel (x, y): cell hash at `size`, plus a pixel-level second octave mixed by roughness. */
export function grainNoise(x: number, y: number, p: P<'grain'>): number {
  const size = Math.max(1, Math.floor(p.size));
  const n1 = grainHash(Math.floor(x / size), Math.floor(y / size), p.seed) / 4294967296;
  const q = (p.roughness / 100) * GRAIN_ROUGHNESS_MIX;
  if (q <= 0) return n1;
  const n2 = grainHash(x, y, (p.seed ^ GRAIN_SALT) >>> 0) / 4294967296;
  return n1 * (1 - q) + n2 * q;
}

export function grain(rgb: Float64Array, w: number, h: number, p: P<'grain'>): Float64Array {
  const out = new Float64Array(rgb.length);
  const k = (p.amount / 100) * GRAIN_GAIN;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const s = k * (grainNoise(x, y, p) - 0.5);
      out[i * 3] = clamp01(rgb[i * 3] + s);
      out[i * 3 + 1] = clamp01(rgb[i * 3 + 1] + s);
      out[i * 3 + 2] = clamp01(rgb[i * 3 + 2] + s);
    }
  }
  return out;
}

/** The adjusted image of a detail layer (before blend / opacity / mask) for the whole current image. */
export function applyDetailCPU(rgb: Float64Array, w: number, h: number, layer: AdjustmentLayer): Float64Array {
  const long = Math.max(w, h);
  switch (layer.type) {
    case 'sharpen':
      return unsharpLuma(rgb, w, h, layer.params.radius, layer.params.amount / 100, false, layer.params.threshold / 255);
    case 'blur': {
      const out = gaussBlurPlanes(rgb, w, h, 3, layer.params.radius / 2);
      return out === rgb ? rgb : out.map(clamp01);
    }
    case 'noiseReduction':
      return noiseReduction(rgb, w, h, layer.params);
    case 'clarity':
      return unsharpLuma(rgb, w, h, CLARITY_RADIUS * long, (layer.params.amount / 100) * CLARITY_GAIN, true);
    case 'texture':
      return unsharpLuma(rgb, w, h, Math.max(TEXTURE_MIN_RADIUS, TEXTURE_RADIUS * long), (layer.params.amount / 100) * TEXTURE_GAIN, false);
    case 'dehaze':
      return dehaze(rgb, w, h, layer.params);
    case 'vignette':
      return vignette(rgb, w, h, layer.params);
    case 'grain':
      return grain(rgb, w, h, layer.params);
    default:
      return rgb;
  }
}

// ---------------------------------------------------------------------------
// Whole-image reference render
// ---------------------------------------------------------------------------

/** RGBA, row-major, sRGB-encoded floats in [0,1], not premultiplied. */
export interface FloatImage {
  width: number;
  height: number;
  data: Float32Array;
}

/**
 * Apply the document to an image: geometry (one bilinear resample, may change
 * the size) → each enabled layer, scaled by its mask (rendered once per mask in
 * the geometry-corrected space), detail layers see the whole current image. Pure and
 * deterministic; alpha is never touched by layers.
 */
export function renderDocCPU(
  doc: Pick<PhotoDoc, 'layers'> & Partial<Pick<PhotoDoc, 'geometry' | 'masks'>>,
  source: FloatImage,
  assets: MaskAssets = {},
): FloatImage {
  const image = doc.geometry ? applyGeometryCPU(source, doc.geometry) : source;
  const plans = planLayers(doc);
  const cache = new Map<Mask, Float32Array>();
  const masks = plans.map((plan) => {
    const m = resolveLayerMask(doc, plan.layer);
    if (!m) return null;
    let r = cache.get(m);
    if (!r) {
      r = renderMaskCPU(m, image, assets);
      cache.set(m, r);
    }
    return r;
  });
  const out = new Float32Array(image.data.length);
  const w = image.width;
  const h = image.height;
  const px = w * h;
  // Working colour, float64 RGB. Runs of per-pixel layers are applied pixel by
  // pixel (identical arithmetic to MM97/MM98); a detail layer (neighbourhood op,
  // design 5.4) sees the whole current image, then is blended per pixel.
  let cur: Float64Array = new Float64Array(px * 3);
  for (let i = 0; i < px; i += 1) {
    cur[i * 3] = image.data[i * 4];
    cur[i * 3 + 1] = image.data[i * 4 + 1];
    cur[i * 3 + 2] = image.data[i * 4 + 2];
  }
  let k = 0;
  while (k < plans.length) {
    if (isDetailType(plans[k].layer.type)) {
      const layer = plans[k].layer;
      const adjusted = applyDetailCPU(cur, w, h, layer);
      const mk = masks[k] as Float32Array | null;
      const next = new Float64Array(px * 3);
      for (let i = 0; i < px; i += 1) {
        const o = i * 3;
        const r = mixLayer([cur[o], cur[o + 1], cur[o + 2]], layer, [adjusted[o], adjusted[o + 1], adjusted[o + 2]], mk ? mk[i] : 1);
        next[o] = r[0];
        next[o + 1] = r[1];
        next[o + 2] = r[2];
      }
      cur = next;
      k += 1;
      continue;
    }
    let end = k;
    while (end < plans.length && !isDetailType(plans[end].layer.type)) end += 1;
    for (let i = 0; i < px; i += 1) {
      const o = i * 3;
      let c: RGB = [cur[o], cur[o + 1], cur[o + 2]];
      for (let m = k; m < end; m += 1) c = applyLayer(c, plans[m], masks[m] ? (masks[m] as Float32Array)[i] : 1);
      cur[o] = c[0];
      cur[o + 1] = c[1];
      cur[o + 2] = c[2];
    }
    k = end;
  }
  for (let i = 0; i < px; i += 1) {
    out[i * 4] = cur[i * 3];
    out[i * 4 + 1] = cur[i * 3 + 1];
    out[i * 4 + 2] = cur[i * 3 + 2];
    out[i * 4 + 3] = image.data[i * 4 + 3];
  }
  return { width: w, height: h, data: out };
}

/** 8-bit quantization used by the goldens: round-half-up of v·255. */
export function toBytes(image: FloatImage): Uint8ClampedArray {
  const out = new Uint8ClampedArray(image.data.length);
  for (let i = 0; i < out.length; i += 1) out[i] = Math.floor(clamp01(image.data[i]) * 255 + 0.5);
  return out;
}

export function fromBytes(width: number, height: number, bytes: ArrayLike<number>): FloatImage {
  const data = new Float32Array(width * height * 4);
  for (let i = 0; i < data.length; i += 1) data[i] = bytes[i] / 255;
  return { width, height, data };
}

export { HSL_RANGE_IDS };
export type { HslRange };
