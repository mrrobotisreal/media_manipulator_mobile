// DO NOT EDIT. Copied from media-manipulator-ui lib/photo/gl/uniforms.ts by scripts/sync-photo-fixtures.mjs
// (npm run photo:sync). The web repo is the source of the model and the math (ADR MA-0010);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/**
 * Pure (GPU-free) parts of the preview renderer: which `#define` a layer type
 * compiles with, how a layer's params are packed into the shader's `uP[]` vec4
 * slots, and how curves are packed into the 256×1 RGBA lookup texture. The
 * layout is mirrored by `shaders/adjustSource.ts`; tests pin it.
 */
import { buildCurveLuts, hexToRgb, isDetailType, LUT_SIZE } from './colorMath';
import type { AdjustmentLayer, LayerType } from './photoTypes';

/** Layer types the GPU rung-1 shader implements (`FRAG_SRC`). The rung-4 detail ops run in `detailSource.ts` (MM99). */
export const GPU_LAYER_TYPES: readonly LayerType[] = [
  'exposure', 'brightnessContrast', 'tone', 'levels', 'curves', 'whiteBalance', 'vibranceSaturation', 'hsl',
  'colorBalance', 'blackWhite', 'channelMixer', 'photoFilter', 'splitTone', 'lut', 'invert', 'posterize',
  'threshold', 'gamma', 'redEye',
];

/** `#define` for a layer type (one program per type, cached by this name). */
export const defineFor = (type: LayerType): string => `T_${type.toUpperCase()}`;
export const isGpuLayer = (type: string): boolean => (GPU_LAYER_TYPES as readonly string[]).includes(type) || isDetailType(type);

export const UNIFORM_SLOTS = 40;
/** The shader loops at most this many HSL ranges (2 slots each after the master slot). */
export const MAX_GPU_HSL_RANGES = 16;
export const BLEND_INDEX = { normal: 0, luminosity: 1, color: 2 } as const;

export interface PackedLayer {
  define: string;
  /** vec4 slots, flattened (length = UNIFORM_SLOTS * 4). */
  slots: Float32Array;
  /** `uN`: HSL range count. */
  n: number;
  blend: number;
  opacity: number;
}

export function packLayerUniforms(layer: AdjustmentLayer): PackedLayer {
  const slots = new Float32Array(UNIFORM_SLOTS * 4);
  const set = (slot: number, ...v: number[]) => v.forEach((x, i) => (slots[slot * 4 + i] = x));
  let n = 0;
  switch (layer.type) {
    case 'exposure':
      set(0, layer.params.ev, layer.params.offset, layer.params.gamma);
      break;
    case 'brightnessContrast':
      set(0, layer.params.brightness, layer.params.contrast);
      break;
    case 'tone':
      set(0, layer.params.highlights, layer.params.shadows, layer.params.whites, layer.params.blacks);
      break;
    case 'levels': {
      const p = layer.params;
      [p.master, p.r, p.g, p.b].forEach((c, i) => {
        set(i * 2, c.inBlack, c.inWhite, c.gamma);
        set(i * 2 + 1, c.outBlack, c.outWhite);
      });
      break;
    }
    case 'whiteBalance':
      set(0, layer.params.temperature, layer.params.tint);
      break;
    case 'vibranceSaturation':
      set(0, layer.params.vibrance, layer.params.saturation);
      break;
    case 'hsl': {
      const { master, ranges } = layer.params;
      set(0, master.hue, master.saturation, master.lightness);
      n = Math.min(ranges.length, MAX_GPU_HSL_RANGES);
      for (let i = 0; i < n; i += 1) {
        const r = ranges[i];
        set(1 + 2 * i, r.center, r.width, r.feather, r.hue);
        set(2 + 2 * i, r.saturation, r.lightness);
      }
      break;
    }
    case 'colorBalance': {
      const p = layer.params;
      set(0, p.shadows.r, p.shadows.g, p.shadows.b);
      set(1, p.midtones.r, p.midtones.g, p.midtones.b);
      set(2, p.highlights.r, p.highlights.g, p.highlights.b);
      set(3, p.preserveLuminosity ? 1 : 0);
      break;
    }
    case 'blackWhite': {
      const p = layer.params;
      set(0, p.reds, p.yellows, p.greens, p.cyans);
      set(1, p.blues, p.magentas, p.tint ? 1 : 0, p.tint?.hue ?? 0);
      set(2, p.tint?.saturation ?? 0);
      break;
    }
    case 'channelMixer': {
      const p = layer.params;
      set(0, p.r.r, p.r.g, p.r.b, p.r.constant);
      set(1, p.g.r, p.g.g, p.g.b, p.g.constant);
      set(2, p.b.r, p.b.g, p.b.b, p.b.constant);
      set(3, p.monochrome ? 1 : 0);
      break;
    }
    case 'photoFilter': {
      const rgb = hexToRgb(layer.params.color);
      set(0, rgb[0], rgb[1], rgb[2], layer.params.density / 100);
      set(1, layer.params.preserveLuminosity ? 1 : 0);
      break;
    }
    case 'splitTone':
      set(0, layer.params.shadows.hue, layer.params.shadows.saturation, layer.params.highlights.hue, layer.params.highlights.saturation);
      set(1, layer.params.balance);
      break;
    case 'lut':
      set(0, layer.params.intensity);
      break;
    case 'posterize':
      set(0, layer.params.levels);
      break;
    case 'threshold':
      set(0, layer.params.level);
      break;
    case 'gamma':
      set(0, layer.params.gamma);
      break;
    default:
      break;
  }
  return { define: defineFor(layer.type), slots, n, blend: BLEND_INDEX[layer.blend], opacity: layer.opacity };
}

/** 256×1 RGBA float texels: r, g, b, master curve (the shader's `uCurves`). */
export function packCurveTexture(params: Extract<AdjustmentLayer, { type: 'curves' }>['params']): Float32Array {
  const luts = buildCurveLuts(params);
  const out = new Float32Array(LUT_SIZE * 4);
  for (let i = 0; i < LUT_SIZE; i += 1) {
    out[i * 4] = luts.r[i];
    out[i * 4 + 1] = luts.g[i];
    out[i * 4 + 2] = luts.b[i];
    out[i * 4 + 3] = luts.master[i];
  }
  return out;
}

/** Layers the preview draws, in order (enabled, visible, GPU-implemented). */
export function planGpuLayers(layers: AdjustmentLayer[]): AdjustmentLayer[] {
  return layers.filter((l) => l.enabled && l.opacity > 0 && isGpuLayer(l.type));
}

/** Texture size for a source: the longest side is scaled down so the area stays within `maxPixels`. */
export function fitTextureSize(width: number, height: number, maxPixels = 24_000_000): { width: number; height: number; scale: number } {
  const px = width * height;
  if (px <= maxPixels) return { width, height, scale: 1 };
  const scale = Math.sqrt(maxPixels / px);
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)), scale };
}
