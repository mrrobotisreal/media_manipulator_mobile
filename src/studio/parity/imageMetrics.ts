// DO NOT EDIT. Copied from media-manipulator-ui parity-harness/imageMetrics.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import type { ParityTolerance } from '../parityTolerances';

/**
 * Pure image metrics for the parity comparator: PSNR + mean CIEDE2000, plus
 * the noise-floor calibration that turns the reasoned thresholds in
 * lib/studio/parityTolerances.ts into effective pass/fail bounds (research
 * ticket 02: calibrate against the identity/passthrough EDL first). No Node
 * or DOM imports — this module is covered by the laptop Vitest gate with
 * synthetic buffers.
 */

export interface FrameBuf {
  width: number;
  height: number;
  /** RGBA bytes, rows top-down. Alpha is ignored by every metric. */
  data: Uint8Array | Uint8ClampedArray;
}

function assertComparable(a: FrameBuf, b: FrameBuf): void {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`frame size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  const bytes = a.width * a.height * 4;
  if (a.data.length !== bytes || b.data.length !== bytes) {
    throw new Error('frame buffer length does not match width*height*4');
  }
}

/** PSNR in dB over the RGB channels (alpha ignored). Identical frames → Infinity. */
export function psnr(a: FrameBuf, b: FrameBuf): number {
  assertComparable(a, b);
  let sum = 0;
  const n = a.width * a.height;
  for (let i = 0; i < n; i += 1) {
    const o = i * 4;
    const dr = a.data[o] - b.data[o];
    const dg = a.data[o + 1] - b.data[o + 1];
    const db = a.data[o + 2] - b.data[o + 2];
    sum += dr * dr + dg * dg + db * db;
  }
  const mse = sum / (n * 3);
  if (mse === 0) return Infinity;
  return 10 * Math.log10((255 * 255) / mse);
}

// --- sRGB → CIELAB (D65) ---------------------------------------------------

function srgbLin(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

const LAB_F = (t: number): number => (t > 0.008856451679 ? Math.cbrt(t) : (903.2962962 * t + 16) / 116);

/** sRGB bytes → [L, a, b] under D65. */
export function srgbToLab(r: number, g: number, b: number): [number, number, number] {
  const rl = srgbLin(r);
  const gl = srgbLin(g);
  const bl = srgbLin(b);
  // sRGB D65 matrix, normalized to the D65 white point.
  const x = (0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl) / 0.95047;
  const y = 0.2126729 * rl + 0.7151522 * gl + 0.072175 * bl;
  const z = (0.0193339 * rl + 0.119192 * gl + 0.9503041 * bl) / 1.08883;
  const fx = LAB_F(x);
  const fy = LAB_F(y);
  const fz = LAB_F(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const rad = (deg: number): number => (deg * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

/** CIEDE2000 color difference (Sharma et al. 2005 formulation, kL=kC=kH=1). */
export function ciede2000(lab1: [number, number, number], lab2: [number, number, number]): number {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cm, 7) / (Math.pow(Cm, 7) + Math.pow(25, 7))));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h1p = C1p === 0 ? 0 : (deg(Math.atan2(b1, a1p)) + 360) % 360;
  const h2p = C2p === 0 ? 0 : (deg(Math.atan2(b2, a2p)) + 360) % 360;

  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp) / 2);

  const Lmp = (L1 + L2) / 2;
  const Cmp = (C1p + C2p) / 2;
  let hmp: number;
  if (C1p * C2p === 0) {
    hmp = h1p + h2p;
  } else if (Math.abs(h1p - h2p) <= 180) {
    hmp = (h1p + h2p) / 2;
  } else if (h1p + h2p < 360) {
    hmp = (h1p + h2p + 360) / 2;
  } else {
    hmp = (h1p + h2p - 360) / 2;
  }

  const T =
    1 -
    0.17 * Math.cos(rad(hmp - 30)) +
    0.24 * Math.cos(rad(2 * hmp)) +
    0.32 * Math.cos(rad(3 * hmp + 6)) -
    0.2 * Math.cos(rad(4 * hmp - 63));
  const dTheta = 30 * Math.exp(-Math.pow((hmp - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(Cmp, 7) / (Math.pow(Cmp, 7) + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(Lmp - 50, 2)) / Math.sqrt(20 + Math.pow(Lmp - 50, 2));
  const Sc = 1 + 0.045 * Cmp;
  const Sh = 1 + 0.015 * Cmp * T;
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc;

  return Math.sqrt(
    Math.pow(dLp / Sl, 2) +
      Math.pow(dCp / Sc, 2) +
      Math.pow(dHp / Sh, 2) +
      Rt * (dCp / Sc) * (dHp / Sh),
  );
}

/** Mean CIEDE2000 over every pixel pair (alpha ignored). */
export function meanDeltaE(a: FrameBuf, b: FrameBuf): number {
  assertComparable(a, b);
  const n = a.width * a.height;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const o = i * 4;
    sum += ciede2000(
      srgbToLab(a.data[o], a.data[o + 1], a.data[o + 2]),
      srgbToLab(b.data[o], b.data[o + 1], b.data[o + 2]),
    );
  }
  return sum / n;
}

/** Amplified absolute-difference visualization for failure artifacts. */
export function diffImage(a: FrameBuf, b: FrameBuf, gain = 4): FrameBuf {
  assertComparable(a, b);
  const out = new Uint8ClampedArray(a.data.length);
  for (let i = 0; i < a.data.length; i += 4) {
    out[i] = Math.min(255, Math.abs(a.data[i] - b.data[i]) * gain);
    out[i + 1] = Math.min(255, Math.abs(a.data[i + 1] - b.data[i + 1]) * gain);
    out[i + 2] = Math.min(255, Math.abs(a.data[i + 2] - b.data[i + 2]) * gain);
    out[i + 3] = 255;
  }
  return { width: a.width, height: a.height, data: out };
}

// --- tolerance calibration --------------------------------------------------

/** Metrics measured on the passthrough (identity) scenario — the noise floor. */
export interface NoiseFloor {
  psnr: number;
  deltaE: number;
}

/**
 * The PSNR the reasoned thresholds assumed the passthrough scenario would hit
 * (parityTolerances.ts passthrough row / design doc calibration protocol §1).
 */
export const ASSUMED_PSNR_FLOOR = 40;
/** The mean ΔE2000 the reasoned ΔE thresholds implicitly assumed at the floor. */
export const ASSUMED_DELTAE_FLOOR = 1.0;
/**
 * Extra headroom under `--fallback` (SwiftShader): deterministic but not
 * bit-identical to NVIDIA GL (filtering/rounding LSBs — research ticket 02).
 */
export const SWIFTSHADER_HEADROOM = { psnr: 2, deltaE: 0.5 } as const;
/**
 * Absolute sanity bound for the passthrough scenario itself: below this the
 * harness is broken (wrong frames, seek mismatch, rasterizer surprise), not
 * merely uncalibrated.
 */
export const PASSTHROUGH_SANITY_PSNR = 25;

/**
 * Effective threshold for a row after noise-floor calibration (design doc
 * "Calibration protocol": shift PSNR rows down by however far the measured
 * floor fell below the assumed 40 dB; widen ΔE rows by the floor's excess over
 * the assumed 1.0) and after SwiftShader headroom when on fallback.
 */
export function effectiveThreshold(row: ParityTolerance, floor: NoiseFloor, fallback: boolean): number {
  if (row.metric === 'psnr') {
    let t = row.threshold - Math.max(0, ASSUMED_PSNR_FLOOR - floor.psnr);
    if (fallback) t -= SWIFTSHADER_HEADROOM.psnr;
    return t;
  }
  let t = row.threshold + Math.max(0, floor.deltaE - ASSUMED_DELTAE_FLOOR);
  if (fallback) t += SWIFTSHADER_HEADROOM.deltaE;
  return t;
}

/** Pass/fail for a measured metric value against a calibrated row. */
export function evaluateMetric(
  row: ParityTolerance,
  value: number,
  floor: NoiseFloor,
  fallback: boolean,
): { pass: boolean; effective: number } {
  const effective = effectiveThreshold(row, floor, fallback);
  return { pass: row.metric === 'psnr' ? value >= effective : value <= effective, effective };
}
