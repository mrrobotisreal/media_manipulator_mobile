// DO NOT EDIT. Copied from media-manipulator-ui lib/photo/brushEngine.ts by scripts/sync-photo-fixtures.mjs
// (npm run photo:sync). The web repo is the source of the model and the math (ADR MA-0010);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/**
 * Brush engine (MM98 decision 3): paints into a plain alpha raster (no canvas,
 * so it is unit-testable) at ≤ 1024 px on the long side of the
 * geometry-corrected space, and bakes it to a PNG data URI. The editor
 * encodes through an offscreen canvas; tests inject an encoder.
 */
import type { AlphaImage } from './colorMath';
import { smoothstep } from './colorMath';
import { PHOTO_MAX_BRUSH_PNG_BYTES, PHOTO_MAX_BRUSH_PX } from './photoTypes';
import { dataUriBytes } from './maskOps';

export interface BrushSettings {
  /** Diameter in pixels of the geometry-corrected output (1..500). */
  size: number;
  /** 0..100: where the falloff starts. */
  hardness: number;
  /** 0..100: opacity of one dab. */
  flow: number;
  erase: boolean;
}
export const DEFAULT_BRUSH: BrushSettings = { size: 60, hardness: 50, flow: 100, erase: false };
export const BRUSH_SIZE_MIN = 1;
export const BRUSH_SIZE_MAX = 500;

/** Raster size for an output size: the long side capped at 1024, aspect kept. */
export function brushRasterSize(outW: number, outH: number, cap = PHOTO_MAX_BRUSH_PX): { width: number; height: number; scale: number } {
  const scale = Math.min(1, cap / Math.max(outW, outH, 1));
  return { width: Math.max(1, Math.round(outW * scale)), height: Math.max(1, Math.round(outH * scale)), scale };
}

export class BrushRaster {
  readonly alpha: Float32Array;
  dirty = false;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.alpha = new Float32Array(width * height);
  }

  /** Start from an existing alpha image (resampled to this raster with bilinear). */
  static from(img: AlphaImage | null, width: number, height: number): BrushRaster {
    const r = new BrushRaster(width, height);
    if (!img) return r;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const u = ((x + 0.5) / width) * img.width - 0.5;
        const v = ((y + 0.5) / height) * img.height - 0.5;
        const x0 = Math.floor(u);
        const y0 = Math.floor(v);
        const tx = u - x0;
        const ty = v - y0;
        const at = (xx: number, yy: number) => img.alpha[Math.min(img.height - 1, Math.max(0, yy)) * img.width + Math.min(img.width - 1, Math.max(0, xx))] / 255;
        r.alpha[y * width + x] = (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
      }
    }
    return r;
  }

  /** One dab centred at raster pixel (cx, cy) with a raster-pixel `diameter`. */
  stamp(cx: number, cy: number, diameter: number, s: Pick<BrushSettings, 'hardness' | 'flow' | 'erase'>): void {
    const R = Math.max(0.5, diameter / 2);
    const h = Math.min(0.999, Math.max(0, s.hardness / 100));
    const flow = Math.min(1, Math.max(0, s.flow / 100));
    const x0 = Math.max(0, Math.floor(cx - R - 1));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + R + 1));
    const y0 = Math.max(0, Math.floor(cy - R - 1));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + R + 1));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / R;
        if (d >= 1) continue;
        const v = (1 - smoothstep(h, 1, d)) * flow;
        const i = y * this.width + x;
        const a = this.alpha[i];
        this.alpha[i] = s.erase ? a * (1 - v) : a + (1 - a) * v;
      }
    }
    this.dirty = true;
  }

  /** A stroke segment: dabs every max(1, 15 % of the diameter) along the line. */
  stroke(from: { x: number; y: number }, to: { x: number; y: number }, diameter: number, s: Pick<BrushSettings, 'hardness' | 'flow' | 'erase'>): void {
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    const step = Math.max(1, diameter * 0.15);
    const n = Math.max(1, Math.ceil(len / step));
    for (let i = 0; i <= n; i += 1) {
      const t = i / n;
      this.stamp(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, diameter, s);
    }
  }

  /** RGBA bytes (white, alpha = coverage) for PNG encoding. */
  toRgba(): Uint8ClampedArray {
    const out = new Uint8ClampedArray(this.width * this.height * 4);
    for (let i = 0; i < this.alpha.length; i += 1) {
      out[i * 4] = 255;
      out[i * 4 + 1] = 255;
      out[i * 4 + 2] = 255;
      out[i * 4 + 3] = Math.round(this.alpha[i] * 255);
    }
    return out;
  }
  toAlphaImage(): AlphaImage {
    const a = new Uint8Array(this.alpha.length);
    for (let i = 0; i < a.length; i += 1) a[i] = Math.round(this.alpha[i] * 255);
    return { width: this.width, height: this.height, alpha: a };
  }
  /** Half-resolution copy (box filter) used when a PNG exceeds the byte cap. */
  halved(): BrushRaster {
    const w = Math.max(1, this.width >> 1);
    const h = Math.max(1, this.height >> 1);
    const r = new BrushRaster(w, h);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      const sx = Math.min(this.width - 1, x * 2);
      const sy = Math.min(this.height - 1, y * 2);
      r.alpha[y * w + x] = (this.alpha[sy * this.width + sx] + this.alpha[sy * this.width + Math.min(this.width - 1, sx + 1)] + this.alpha[Math.min(this.height - 1, sy + 1) * this.width + sx] + this.alpha[Math.min(this.height - 1, sy + 1) * this.width + Math.min(this.width - 1, sx + 1)]) / 4;
    }
    return r;
  }
}

export type PngEncoder = (rgba: Uint8ClampedArray, width: number, height: number) => Promise<string>;

/** Canvas-based encoder (browser). */
export const canvasPngEncoder: PngEncoder = async (rgba, width, height) => {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');
  ctx.putImageData(new ImageData(rgba as unknown as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
  return c.toDataURL('image/png');
};

/** Bake to a PNG data URI under the byte cap, halving the raster while it is too big. */
export async function bakeBrush(raster: BrushRaster, encode: PngEncoder = canvasPngEncoder): Promise<{ png: string; width: number; height: number }> {
  let r = raster;
  for (let i = 0; i < 4; i += 1) {
    const png = await encode(r.toRgba(), r.width, r.height);
    if (dataUriBytes(png) <= PHOTO_MAX_BRUSH_PNG_BYTES || r.width <= 8) return { png, width: r.width, height: r.height };
    r = r.halved();
  }
  const png = await encode(r.toRgba(), r.width, r.height);
  return { png, width: r.width, height: r.height };
}
