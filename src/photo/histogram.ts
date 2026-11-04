/**
 * The editor's histogram (ticket MA50 decision 3): 64 bins per channel (r, g, b, luma) from the
 * rendered preview read back at 256 px on the long side every 300 ms. Pure; `PhotoCanvas` feeds it
 * `readPixels()` bytes (RGBA8, unpremultiplied). Transparent pixels are skipped, like the web's
 * `computeHistogram` (`lib/photo/gl/histogram.ts`), whose luma rounding this keeps.
 */
export const HISTOGRAM_BINS = 64;
export const HISTOGRAM_LONG_SIDE = 256;
export const HISTOGRAM_INTERVAL_MS = 300;

export interface Histogram64 {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  luma: Uint32Array;
  /** Highest bin across the four channels (plot scale). */
  max: number;
  /** Pixels counted (non-transparent). */
  count: number;
}

const bin = (v: number) => v >> 2; // 256 levels -> 64 bins

export function computeHistogram64(rgba: ArrayLike<number>): Histogram64 {
  const r = new Uint32Array(HISTOGRAM_BINS);
  const g = new Uint32Array(HISTOGRAM_BINS);
  const b = new Uint32Array(HISTOGRAM_BINS);
  const luma = new Uint32Array(HISTOGRAM_BINS);
  let count = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    const R = rgba[i]!;
    const G = rgba[i + 1]!;
    const B = rgba[i + 2]!;
    r[bin(R)]! += 1;
    g[bin(G)]! += 1;
    b[bin(B)]! += 1;
    luma[bin(Math.min(255, Math.round(0.2126 * R + 0.7152 * G + 0.0722 * B)))]! += 1;
    count += 1;
  }
  let max = 0;
  for (let i = 0; i < HISTOGRAM_BINS; i += 1) max = Math.max(max, r[i]!, g[i]!, b[i]!, luma[i]!);
  return { r, g, b, luma, max, count };
}

/** Readback size: the long side scaled to 256 (never up), aspect kept, at least 1 px. */
export function histogramSize(
  width: number,
  height: number,
): { width: number; height: number; scale: number } {
  const long = Math.max(width, height, 1);
  const scale = Math.min(1, HISTOGRAM_LONG_SIDE / long);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

/** Bin heights normalised to 0..1 for a plot (sqrt scale keeps the shadows readable). */
export function normaliseBins(bins: Uint32Array, max: number): number[] {
  if (max <= 0) return Array.from(bins, () => 0);
  const m = Math.sqrt(max);
  return Array.from(bins, (v) => Math.sqrt(v) / m);
}
