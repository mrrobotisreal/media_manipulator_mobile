/**
 * Pure uniform packing for the Darkroom compositor's SkSL stages (ticket MA62 decision 6; the
 * Aperture `src/photo/skia/uniforms.ts` pattern). Input is the web's own layer shape (`GLLayer`,
 * re-declared here as `CompLayer` because the web file is a test-only reference copy, never imported
 * by app code), so the phone packs exactly what the web's `drawLayer` sets:
 *
 * - `layerQuad`: a port of the web's `quadGeometry` (corner positions in canvas pixels + the crop's
 *   UV rectangle); `packGeometry` turns it into the inverse affine map the geometry stage evaluates.
 *   The parity suite checks `layerQuad` against the copied web code's actual `bufferData` calls.
 * - one `pack*` per stage, each returning the flat float array in the SkSL's declaration order
 *   (`getUniformFloatCount()` is pinned by the parity suite).
 * - `lutAtlas`: the parsed cube as a 2D atlas (the Aperture layout).
 *
 * Everything returns fresh small arrays; the builder (`compositor.ts`) builds a clip's chain once and
 * only remakes a stage when its packed values change (decision 0: no per-frame rebuild). The packers
 * are worklets, so S4 can derive keyframed uniforms on the UI runtime.
 */
import type { ParsedLut } from '../../../../photo/studioLutParser';
import type { StudioBlendMode } from '../../../studioTypes';
import type { StageId } from './shaders/stages';

export interface CompTransform {
  x: number;
  y: number;
  scale: number;
  rotationDeg: number;
}
export interface CompCrop {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface CompEq {
  brightness: number;
  contrast: number;
  saturation: number;
}
export interface CompLumetri {
  exposure: number;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
  vibrance: number;
}
export interface CompChroma {
  keyColor: [number, number, number];
  similarity: number;
  blend: number;
  despill: number;
}

/** The web's `GLLayer` (glCompositor.ts), field for field; `slot`/`imageKey` name the source. */
export interface CompLayer {
  slot: number;
  srcW: number;
  srcH: number;
  transform?: CompTransform;
  crop?: CompCrop;
  opacity: number;
  blendMode?: StudioBlendMode;
  eq?: CompEq;
  lumetri?: CompLumetri;
  lut?: { key: string; intensity: number };
  chroma?: CompChroma;
  solid?: [number, number, number];
  wipe?: { left: number; top: number; right: number; bottom: number };
  imageKey?: string;
}

function clamp01(v: number): number {
  'worklet';
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export interface Quad {
  /** Canvas-pixel corners (y down): top-left, top-right, bottom-left of the quad. */
  tl: [number, number];
  tr: [number, number];
  bl: [number, number];
  br: [number, number];
  /** The source UV rectangle (u0, v0, u1, v1); v = 0 is the image top. */
  uv: [number, number, number, number];
}

/**
 * Port of the web's `quadGeometry` (crop -> fit -> position -> rotate), in canvas pixels instead of
 * clip space (the web converts with `(px / W) * 2 - 1`, `1 - (py / H) * 2`).
 */
export function layerQuad(layer: CompLayer, W: number, H: number): Quad {
  'worklet';
  const cl = layer.crop?.left ?? 0;
  const ct = layer.crop?.top ?? 0;
  const cr = layer.crop?.right ?? 0;
  const cb = layer.crop?.bottom ?? 0;
  const croppedW = Math.max(1, layer.srcW * (1 - cl - cr));
  const croppedH = Math.max(1, layer.srcH * (1 - ct - cb));

  const scale = layer.transform?.scale ?? 1;
  const boxW = W * scale;
  const boxH = H * scale;
  const fit = Math.min(boxW / croppedW, boxH / croppedH);
  const drawW = croppedW * fit;
  const drawH = croppedH * fit;

  const cx = W / 2 + (layer.transform?.x ?? 0) * W;
  const cy = H / 2 + (layer.transform?.y ?? 0) * H;
  const theta = ((layer.transform?.rotationDeg ?? 0) * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  // Clockwise rotation in y-down pixel space: x' = x cos - y sin, y' = x sin + y cos.
  const corner = (dx: number, dy: number): [number, number] => [
    cx + dx * cos - dy * sin,
    cy + dx * sin + dy * cos,
  ];
  const hw = drawW / 2;
  const hh = drawH / 2;
  return {
    tl: corner(-hw, -hh),
    tr: corner(hw, -hh),
    bl: corner(-hw, hh),
    br: corner(hw, hh),
    uv: [cl, ct, 1 - cr, 1 - cb],
  };
}

/**
 * Geometry stage uniforms: `uM` (2x2), `uT`, `uCrop`, `uSrcSize`. The quad is the image of the unit
 * square under q -> tl + q.x * (tr - tl) + q.y * (bl - tl); the shader needs its inverse. Null when
 * the quad is degenerate (zero area): the layer draws nothing.
 */
export function packGeometry(layer: CompLayer, W: number, H: number): number[] | null {
  'worklet';
  const q = layerQuad(layer, W, H);
  const ex = [q.tr[0] - q.tl[0], q.tr[1] - q.tl[1]];
  const ey = [q.bl[0] - q.tl[0], q.bl[1] - q.tl[1]];
  const det = ex[0]! * ey[1]! - ey[0]! * ex[1]!;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null;
  const m00 = ey[1]! / det;
  const m01 = -ey[0]! / det;
  const m10 = -ex[1]! / det;
  const m11 = ex[0]! / det;
  const t0 = -(m00 * q.tl[0] + m01 * q.tl[1]);
  const t1 = -(m10 * q.tl[0] + m11 * q.tl[1]);
  return [m00, m01, m10, m11, t0, t1, ...q.uv, layer.srcW, layer.srcH];
}

export function packEq(eq: CompEq): number[] {
  'worklet';
  return [eq.brightness, eq.contrast, eq.saturation];
}

export function packLumetri(l: CompLumetri): number[] {
  'worklet';
  return [l.exposure, l.contrast, l.saturation, l.temperature, l.tint, l.vibrance];
}

/** `uLutSize`, `uLutCols`, `uLutIntensity` (the web clamps the intensity: `clamp01`). */
export function packLut(atlas: { size: number; cols: number }, intensity: number): number[] {
  'worklet';
  return [atlas.size, atlas.cols, intensity < 0 ? 0 : intensity > 1 ? 1 : intensity];
}

export function packChroma(c: CompChroma): number[] {
  'worklet';
  return [c.keyColor[0], c.keyColor[1], c.keyColor[2], c.similarity, c.blend, c.despill];
}

/** `uOpacity`, `uHasWipe`, `uWipe`, `uOutSize` (opacity and wipe edges clamped like `drawLayer`). */
export function packAlpha(layer: Pick<CompLayer, 'opacity' | 'wipe'>, W: number, H: number): number[] {
  'worklet';
  const w = layer.wipe;
  return [
    clamp01(layer.opacity),
    w ? 1 : 0,
    w ? clamp01(w.left) : 0,
    w ? clamp01(w.top) : 0,
    w ? clamp01(w.right) : 0,
    w ? clamp01(w.bottom) : 0,
    W,
    H,
  ];
}

export interface RgbaTexture {
  width: number;
  height: number;
  /** Opaque RGBA8, row-major. */
  bytes: Uint8Array;
}

/** The parsed cube as N slices of N x N (slice = blue index), `cols` slices per atlas row. */
export function lutAtlas(lut: ParsedLut): RgbaTexture & { size: number; cols: number } {
  'worklet';
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

/** The web's `hexToRgb01` (preview-surface.tsx / parity buildLayers.ts): bad input = pure green. */
export function hexToRgb01(hex: string): [number, number, number] {
  'worklet';
  const h = hex.replace('#', '');
  if (h.length !== 6) return [0, 1, 0];
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

export interface PlannedStage {
  id: StageId;
  /** The stage's uniforms in SkSL declaration order. */
  floats: number[];
}

/**
 * The stages one layer's chain contains, in the web's fragment order, with their packed uniforms:
 * exactly the web's `uHas*` switches (`drawLayer`): eq when `layer.eq`, lumetri when
 * `layer.lumetri`, lut when `layer.lut` AND its cube is loaded (`hasLut`, the web's `lut ? 1 : 0`),
 * chroma when `layer.chroma`; geometry and alpha always. `solid` (a dip's colour layer) samples a
 * colour, so its geometry is the full canvas. Null: the layer draws nothing (degenerate quad).
 */
export function planLayer(
  layer: CompLayer,
  W: number,
  H: number,
  lut: { size: number; cols: number } | null,
): PlannedStage[] | null {
  'worklet';
  const geometry = packGeometry(layer.solid ? { ...layer, srcW: W, srcH: H } : layer, W, H);
  if (!geometry) return null;
  if (layer.solid) {
    geometry[10] = 1; // a colour shader: the source size is moot
    geometry[11] = 1;
  }
  const out: PlannedStage[] = [{ id: 'geometry', floats: geometry }];
  if (layer.eq) out.push({ id: 'eq', floats: packEq(layer.eq) });
  if (layer.lumetri) out.push({ id: 'lumetri', floats: packLumetri(layer.lumetri) });
  if (layer.lut && lut) out.push({ id: 'lut', floats: packLut(lut, layer.lut.intensity) });
  if (layer.chroma) out.push({ id: 'chromakey', floats: packChroma(layer.chroma) });
  out.push({ id: 'alpha', floats: packAlpha(layer, W, H) });
  return out;
}
