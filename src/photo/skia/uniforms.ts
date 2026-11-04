/**
 * Pure packing of one adjustment layer for the SkSL shader (`shaders/adjust.ts`). The `uP[]` slot
 * layout IS the web's: `packLayerUniforms` is the copied `lib/photo/gl/uniforms.ts`
 * (`../webUniforms.ts`), so phone and browser cannot drift. What is phone-specific is the flat
 * uniform array RN Skia's `makeShaderWithChildren` takes (declaration order) and the two data
 * textures SkSL needs instead of WebGL's float / 3D textures.
 */
import { parseLutCached } from '../colorMath';
import type { AdjustmentLayer } from '../photoTypes';
import { packCurveTexture, packLayerUniforms, UNIFORM_SLOTS } from '../webUniforms';
import { isSkslLayerType, type SkslLayerType } from './shaders/adjust';

export { UNIFORM_SLOTS };

/** Curves texture: 256 x 4, one row per curve (r, g, b, master), 16-bit as (hi, lo, 0, 255). */
export const CURVE_TEX_WIDTH = 256;
export const CURVE_TEX_HEIGHT = 4;

export interface RgbaTexture {
  width: number;
  height: number;
  /** Opaque RGBA8, row-major. */
  bytes: Uint8Array;
}

export interface SkslLayer {
  type: SkslLayerType;
  /** Flattened uniforms in declaration order: uP[40] (160 floats), uN, uOpacity, uBlend, uHasMask[, uLutSize, uLutCols]. */
  uniforms: number[];
  curves?: RgbaTexture;
  lut?: RgbaTexture & { size: number; cols: number };
}

/** Layers the phone preview draws, in order: enabled, visible, rung-1 (rung 4 / masks are MA51). */
export function planSkslLayers(layers: readonly AdjustmentLayer[]): AdjustmentLayer[] {
  return layers.filter((l) => l.enabled && l.opacity > 0 && isSkslLayerType(l.type));
}

const to16 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 65535);

/** The four curve LUTs (colorMath `buildCurveLuts`, via the web packer) as a 256x4 byte texture. */
export function curveTexture(
  params: Extract<AdjustmentLayer, { type: 'curves' }>['params'],
): RgbaTexture {
  const f = packCurveTexture(params); // 256 texels of (r, g, b, master)
  const bytes = new Uint8Array(CURVE_TEX_WIDTH * CURVE_TEX_HEIGHT * 4);
  for (let ch = 0; ch < 4; ch += 1) {
    for (let i = 0; i < CURVE_TEX_WIDTH; i += 1) {
      const v = to16(f[i * 4 + ch]!);
      const o = (ch * CURVE_TEX_WIDTH + i) * 4;
      bytes[o] = v >> 8;
      bytes[o + 1] = v & 0xff;
      bytes[o + 2] = 0;
      bytes[o + 3] = 255;
    }
  }
  return { width: CURVE_TEX_WIDTH, height: CURVE_TEX_HEIGHT, bytes };
}

/** Decode one curve entry back (what the shader's `curveAt` computes). */
export const curveEntry = (tex: RgbaTexture, ch: number, i: number): number => {
  const o = (ch * tex.width + i) * 4;
  return (tex.bytes[o]! * 256 + tex.bytes[o + 1]!) / 65535;
};

/**
 * The parsed `.cube` (colorMath `parseLutCached`: Darkroom's byte-quantised table, red fastest)
 * laid out as N slices of N x N (slice = blue index), `cols` slices per row. Null when the layer
 * has no usable cube (the layer is then the identity, as on the web).
 */
export function lutAtlas(cube: string): (RgbaTexture & { size: number; cols: number }) | null {
  const lut = parseLutCached(cube);
  if (!lut) return null;
  const n = lut.size;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const width = cols * n;
  const height = rows * n;
  const bytes = new Uint8Array(width * height * 4);
  for (let z = 0; z < n; z += 1) {
    const ox = (z % cols) * n;
    const oy = Math.floor(z / cols) * n;
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        const src = ((z * n + y) * n + x) * 3;
        const dst = ((oy + y) * width + ox + x) * 4;
        bytes[dst] = lut.data[src]!;
        bytes[dst + 1] = lut.data[src + 1]!;
        bytes[dst + 2] = lut.data[src + 2]!;
        bytes[dst + 3] = 255;
      }
    }
  }
  return { width, height, bytes, size: n, cols };
}

/**
 * Everything one layer's shader needs. `hasMask` stays false in MA50 (masks are MA51; the shader
 * already takes the mask child and is passed an all-ones one).
 */
export function packSkslLayer(layer: AdjustmentLayer, hasMask = false): SkslLayer | null {
  if (!isSkslLayerType(layer.type)) return null;
  const p = packLayerUniforms(layer);
  const uniforms = [...Array.from(p.slots), p.n, p.opacity, p.blend, hasMask ? 1 : 0];
  const out: SkslLayer = { type: layer.type, uniforms };
  if (layer.type === 'curves') out.curves = curveTexture(layer.params);
  if (layer.type === 'lut') {
    const atlas = lutAtlas(layer.params.cube);
    if (atlas) out.lut = atlas;
    uniforms.push(atlas?.size ?? 0, atlas?.cols ?? 1);
  }
  return out;
}

/** Bytes of the web's float uniform count, for the `getUniformFloatCount()` contract test. */
export const uniformFloatCount = (type: SkslLayerType): number =>
  UNIFORM_SLOTS * 4 + 4 + (type === 'lut' ? 2 : 0);
