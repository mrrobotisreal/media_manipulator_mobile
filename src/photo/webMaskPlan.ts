// DO NOT EDIT. Copied from media-manipulator-ui lib/photo/gl/maskPlan.ts by scripts/sync-photo-fixtures.mjs
// (npm run photo:sync). The web repo is the source of the model and the math (ADR MA-0010);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/**
 * Pure (GPU-free) parts of the MM98 render passes: which passes run and in what
 * order (geometry → masks → adjust), the cache keys that decide when a mask is
 * recomputed, the alpha-texture packing for brush/subject rasters, and how
 * components and geometry are packed into the uniforms of
 * `shaders/maskGeoSource.ts`. Unit tested; `photoRenderer.ts` executes it.
 */
import { LUMA, COLOR_RANGE_MAX_DE, featherSigma, planGeometry, resolveLayerMask, rgbToLab, trig, type AlphaImage, type GeometryPlan } from './colorMath';
import type { AdjustmentLayer, Geometry, Mask, MaskComponent, PhotoDoc } from './photoTypes';
import { isGpuLayer } from './webUniforms';

export { LUMA };

/** FNV-1a 32-bit over a string, base36. Stable across runs (cache keys, not security). */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** A mask's own hash: changes only when the mask (components, feather, invert, opacity) changes. */
export const maskHash = (m: Mask): string => hashString(JSON.stringify(m));
export const geometryHash = (g: Geometry): string => hashString(JSON.stringify(g));

/**
 * Cache key of a mask raster: its own hash plus the geometry (the mask space
 * and the luminosity/colour-range inputs depend on it) plus the source id.
 * An adjustment's params are NOT part of it, so a slider drag never recomputes
 * a mask.
 */
export const maskCacheKey = (m: Mask, g: Geometry, sourceId: string): string => `${sourceId}|${geometryHash(g)}|${maskHash(m)}`;

export type RenderPass =
  | { kind: 'geometry' }
  | { kind: 'mask'; key: string; mask: Mask }
  | { kind: 'adjust'; layer: AdjustmentLayer; maskKey: string | null };

const isIdentity = (g: Geometry) => g.rotate === 0 && !g.flipH && !g.flipV && !g.perspective && !g.crop;
export const hasGeometry = (g: Geometry): boolean => !isIdentity(g);

/**
 * Pass order: the geometry resample (when non-identity), then every distinct
 * mask used by a drawn layer (once, shared by refs), then the adjustments in
 * stack order.
 */
export function planPasses(doc: Pick<PhotoDoc, 'layers' | 'geometry' | 'masks'>, sourceId = 'src'): RenderPass[] {
  const out: RenderPass[] = [];
  if (doc.geometry && hasGeometry(doc.geometry)) out.push({ kind: 'geometry' });
  const layers = doc.layers.filter((l) => l.enabled && l.opacity > 0 && isGpuLayer(l.type));
  const geo = doc.geometry ?? ({ rotate: 0, flipH: false, flipV: false, perspective: null, crop: null, fill: 'transparent' } as Geometry);
  const seen = new Set<string>();
  const keys = new Map<AdjustmentLayer, string | null>();
  for (const layer of layers) {
    const m = resolveLayerMask(doc, layer);
    if (!m || m.components.length === 0) {
      keys.set(layer, null);
      continue;
    }
    const key = maskCacheKey(m, geo, sourceId);
    keys.set(layer, key);
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ kind: 'mask', key, mask: m });
    }
  }
  for (const layer of layers) out.push({ kind: 'adjust', layer, maskKey: keys.get(layer) ?? null });
  return out;
}

/** A tiny LRU keyed cache that counts computes (the renderer keeps mask textures in one). */
export class KeyedCache<V> {
  private map = new Map<string, V>();
  computes = 0;
  constructor(
    private readonly max: number,
    private readonly onEvict?: (v: V) => void,
  ) {}
  get(key: string, make: () => V): V {
    const hit = this.map.get(key);
    if (hit !== undefined) {
      this.map.delete(key);
      this.map.set(key, hit);
      return hit;
    }
    const v = make();
    this.computes += 1;
    this.map.set(key, v);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as string;
      this.onEvict?.(this.map.get(oldest) as V);
      this.map.delete(oldest);
    }
    return v;
  }
  has(key: string): boolean {
    return this.map.has(key);
  }
  clear(): void {
    if (this.onEvict) for (const v of this.map.values()) this.onEvict(v);
    this.map.clear();
  }
  get size(): number {
    return this.map.size;
  }
}

/**
 * Brush/subject alpha rasters are uploaded as R8 textures, one byte per texel,
 * rows tightly packed (UNPACK_ALIGNMENT 1). Input: RGBA bytes (a decoded PNG)
 * or an `AlphaImage`; output: width*height bytes of alpha.
 */
export function packAlphaTexture(src: { width: number; height: number; rgba: ArrayLike<number> } | AlphaImage): { width: number; height: number; data: Uint8Array } {
  const n = src.width * src.height;
  const data = new Uint8Array(n);
  if ('rgba' in src) for (let i = 0; i < n; i += 1) data[i] = src.rgba[i * 4 + 3];
  else for (let i = 0; i < n; i += 1) data[i] = src.alpha[i];
  return { width: src.width, height: src.height, data };
}

export const MASK_DEFINE: Record<MaskComponent['kind'], string> = {
  gradient: 'T_MGRADIENT',
  radial: 'T_MRADIAL',
  brush: 'T_MALPHA',
  subject: 'T_MALPHA',
  luminosity: 'T_MLUMINOSITY',
  colorRange: 'T_MCOLORRANGE',
};
export const MODE_INDEX = { add: 0, subtract: 1, intersect: 2 } as const;
export const MAX_GPU_COLOR_TARGETS = 16;

export interface PackedComponent {
  define: string;
  mode: number;
  m0: [number, number, number, number];
  m1: [number, number, number, number];
  /** Lab targets, flat (3 per colour), colour-range only. */
  lab: Float32Array;
  /** Which alpha raster this component samples, if any. */
  alpha: { kind: 'brush'; png: string } | { kind: 'subject'; maskRef: string } | null;
}

/** Uniform packing of one mask component (layout in `maskGeoSource.ts`). */
export function packMaskComponent(c: MaskComponent): PackedComponent {
  const base = { define: MASK_DEFINE[c.kind], mode: MODE_INDEX[c.mode], m0: [0, 0, 0, 0] as PackedComponent['m0'], m1: [0, 0, 0, 0] as PackedComponent['m1'], lab: new Float32Array(MAX_GPU_COLOR_TARGETS * 3), alpha: null as PackedComponent['alpha'] };
  switch (c.kind) {
    case 'gradient':
      base.m0 = [c.from.x, c.from.y, c.to.x, c.to.y];
      base.m1 = [c.feather, 0, 0, 0];
      break;
    case 'radial': {
      const [cs, sn] = trig(c.rotate);
      base.m0 = [c.center.x, c.center.y, c.rx, c.ry];
      base.m1 = [cs, sn, c.feather, 0];
      break;
    }
    case 'luminosity':
      base.m0 = [c.lo, c.hi, c.feather, 0];
      break;
    case 'colorRange': {
      const n = Math.min(c.colors.length, MAX_GPU_COLOR_TARGETS);
      base.m0 = [(c.fuzziness / 100) * COLOR_RANGE_MAX_DE, n, 0, 0];
      for (let i = 0; i < n; i += 1) {
        const lab = rgbToLab([c.colors[i].r / 255, c.colors[i].g / 255, c.colors[i].b / 255]);
        base.lab.set(lab, i * 3);
      }
      break;
    }
    case 'brush':
      base.alpha = { kind: 'brush', png: c.png };
      break;
    case 'subject':
      base.m0 = [c.invert ? 1 : 0, 0, 0, 0];
      base.alpha = { kind: 'subject', maskRef: c.maskRef };
      break;
  }
  return base;
}

export interface PackedGeometry {
  size: { width: number; height: number };
  g0: [number, number, number, number];
  g1: [number, number, number, number];
  g2: [number, number, number, number];
  g3: [number, number, number, number];
  g4: [number, number, number, number];
  g5: [number, number, number, number];
  fillColor: [number, number, number];
}

/** Uniform packing of the geometry pass (inverse mapping parameters of `planGeometry`). */
export function packGeometry(plan: GeometryPlan): PackedGeometry {
  const p = plan.persp ?? [0, 0, 0, 0, 0, 0, 0, 0];
  const fillMode = plan.fill === 'transparent' ? 0 : plan.fill === 'edge' ? 1 : 2;
  return {
    size: { width: plan.wo, height: plan.ho },
    g0: [plan.w0, plan.h0, plan.wr, plan.hr],
    g1: [plan.ox, plan.oy, plan.wo, plan.ho],
    g2: [plan.cos, plan.sin, plan.flipH ? 1 : 0, plan.flipV ? 1 : 0],
    g3: [p[0], p[1], p[2], p[3]],
    g4: [p[4], p[5], p[6], p[7]],
    g5: [plan.persp ? 1 : 0, fillMode, 0, 0],
    fillColor: Array.isArray(plan.fill) ? [plan.fill[0], plan.fill[1], plan.fill[2]] : [0, 0, 0],
  };
}

export { featherSigma, planGeometry };

/** Mask view modes: `M` cycles off → overlay (red at 50 % where the mask is 0) → alpha. */
export type MaskView = 'off' | 'overlay' | 'alpha';
export const nextMaskView = (v: MaskView): MaskView => (v === 'off' ? 'overlay' : v === 'overlay' ? 'alpha' : 'off');

/** The mask a view shows: the selected layer's (resolved) mask key, or none. */
export function viewedMaskKey(doc: Pick<PhotoDoc, 'layers' | 'geometry' | 'masks'>, selection: string | null, sourceId = 'src'): { key: string; mask: Mask } | null {
  const layer = doc.layers.find((l) => l.id === selection);
  if (!layer) return null;
  const m = resolveLayerMask(doc, layer);
  if (!m || m.components.length === 0) return null;
  return { key: maskCacheKey(m, doc.geometry, sourceId), mask: m };
}
