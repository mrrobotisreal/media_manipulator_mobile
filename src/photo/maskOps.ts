// DO NOT EDIT. Copied from media-manipulator-ui lib/photo/maskOps.ts by scripts/sync-photo-fixtures.mjs
// (npm run photo:sync). The web repo is the source of the model and the math (ADR MA-0010);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/**
 * Pure document edits for masks (MM98): attach / edit / remove components on a
 * layer's mask (inline or a named `doc.masks` entry), install brush and subject
 * results, the Lightroom-style "local adjustment" (three layers sharing one
 * named mask), and the crop-change re-map of every mask coordinate.
 */
import type { AlphaImage } from './colorMath';
import { uniqueLayerId, newLayer } from './layerOps';
import {
  PHOTO_MAX_BRUSH_PNG_BYTES,
  PHOTO_MAX_DOC_BYTES,
  PHOTO_MAX_MASK_COMPONENTS,
  isMaskRef,
  maskComponentSchema,
  maskSchema,
  type AdjustmentLayer,
  type LayerType,
  type Mask,
  type MaskComponent,
  type PhotoDoc,
} from './photoTypes';

export type ComponentKind = MaskComponent['kind'];
export const MASK_KINDS: ComponentKind[] = ['gradient', 'radial', 'brush', 'luminosity', 'colorRange', 'subject'];
export const MAX_COLOR_TARGETS = 8;
export const BRUSH_DOC_WARN_BYTES = 6 * 1024 * 1024;

export const emptyMask = (): Mask => maskSchema.parse({});

/** A fresh component of `kind` with schema defaults; brush and subject need their payload. */
export function defaultComponent(kind: Exclude<ComponentKind, 'brush' | 'subject'>): MaskComponent {
  return maskComponentSchema.parse({ kind });
}

export const layerById = (doc: PhotoDoc, id: string): AdjustmentLayer | undefined => doc.layers.find((l) => l.id === id);

/** The mask a layer edits (resolved through a ref), or null. */
export function maskOfLayer(doc: PhotoDoc, id: string): Mask | null {
  const l = layerById(doc, id);
  if (!l?.mask) return null;
  return isMaskRef(l.mask) ? doc.masks?.[l.mask.ref] ?? null : l.mask;
}

/**
 * Apply `fn` to the mask a layer uses, creating an empty inline mask when it
 * has none. Edits through a ref change the shared named mask (every layer that
 * references it follows). Returns the same doc when `fn` changes nothing.
 */
export function editLayerMask(doc: PhotoDoc, layerId: string, fn: (m: Mask) => Mask): PhotoDoc {
  const layer = layerById(doc, layerId);
  if (!layer) return doc;
  if (layer.mask && isMaskRef(layer.mask)) {
    const ref = layer.mask.ref;
    const cur = doc.masks?.[ref];
    if (!cur) return doc;
    const next = fn(cur);
    if (next === cur) return doc;
    return { ...doc, masks: { ...doc.masks, [ref]: next } };
  }
  const cur = (layer.mask as Mask | null) ?? emptyMask();
  const next = fn(cur);
  if (next === layer.mask) return doc;
  return { ...doc, layers: doc.layers.map((l) => (l.id === layerId ? ({ ...l, mask: next } as AdjustmentLayer) : l)) };
}

export function addComponent(doc: PhotoDoc, layerId: string, comp: MaskComponent): PhotoDoc {
  return editLayerMask(doc, layerId, (m) => (m.components.length >= PHOTO_MAX_MASK_COMPONENTS ? m : { ...m, components: [...m.components, comp] }));
}
export function updateComponent(doc: PhotoDoc, layerId: string, index: number, patch: Partial<MaskComponent>): PhotoDoc {
  return editLayerMask(doc, layerId, (m) => {
    const c = m.components[index];
    if (!c) return m;
    const next = maskComponentSchema.parse({ ...c, ...patch });
    return { ...m, components: m.components.map((x, i) => (i === index ? next : x)) };
  });
}
export function removeComponent(doc: PhotoDoc, layerId: string, index: number): PhotoDoc {
  return editLayerMask(doc, layerId, (m) => (index < 0 || index >= m.components.length ? m : { ...m, components: m.components.filter((_, i) => i !== index) }));
}
export function moveComponent(doc: PhotoDoc, layerId: string, from: number, to: number): PhotoDoc {
  return editLayerMask(doc, layerId, (m) => {
    if (from === to || from < 0 || to < 0 || from >= m.components.length || to >= m.components.length) return m;
    const c = [...m.components];
    const [x] = c.splice(from, 1);
    c.splice(to, 0, x);
    return { ...m, components: c };
  });
}
export function setMaskProps(doc: PhotoDoc, layerId: string, patch: Partial<Pick<Mask, 'feather' | 'invert' | 'opacity'>>): PhotoDoc {
  return editLayerMask(doc, layerId, (m) => maskSchema.parse({ ...m, ...patch }));
}
/** Remove a layer's mask entirely (a ref is dropped; an unreferenced named mask is garbage-collected). */
export function clearLayerMask(doc: PhotoDoc, layerId: string): PhotoDoc {
  const next = { ...doc, layers: doc.layers.map((l) => (l.id === layerId ? ({ ...l, mask: null } as AdjustmentLayer) : l)) };
  return pruneMasks(next);
}

/** Drop `doc.masks` entries no layer references (an empty record becomes absent). */
export function pruneMasks(doc: PhotoDoc): PhotoDoc {
  if (!doc.masks) return doc;
  const used = new Set(doc.layers.map((l) => (isMaskRef(l.mask) ? l.mask.ref : '')).filter(Boolean));
  const keep = Object.entries(doc.masks).filter(([k]) => used.has(k));
  if (keep.length === Object.keys(doc.masks).length) return doc;
  const { masks: _drop, ...rest } = doc;
  void _drop;
  return keep.length === 0 ? (rest as PhotoDoc) : { ...doc, masks: Object.fromEntries(keep) };
}

export function uniqueMaskId(doc: Pick<PhotoDoc, 'masks'>, base = 'mask'): string {
  const used = new Set(Object.keys(doc.masks ?? {}));
  const stem = base.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30) || 'mask';
  if (!used.has(stem)) return stem;
  for (let i = 2; i < 10_000; i += 1) if (!used.has(`${stem}-${i}`)) return `${stem}-${i}`;
  return `${stem}-${Date.now()}`;
}

/** Move a layer's inline mask into `doc.masks` and reference it (so other layers can share it). */
export function shareLayerMask(doc: PhotoDoc, layerId: string): { doc: PhotoDoc; ref: string | null } {
  const layer = layerById(doc, layerId);
  if (!layer?.mask) return { doc, ref: null };
  if (isMaskRef(layer.mask)) return { doc, ref: layer.mask.ref };
  const ref = uniqueMaskId(doc, layer.name || layer.type);
  return {
    ref,
    doc: { ...doc, masks: { ...doc.masks, [ref]: layer.mask }, layers: doc.layers.map((l) => (l.id === layerId ? ({ ...l, mask: { ref } } as AdjustmentLayer) : l)) },
  };
}

/**
 * "Local adjustment": a layer of `type` with an empty mask. With
 * `combo === 'localBasic'` three layers (exposure + tone + saturation) share ONE
 * named mask (`{ref}`), the Lightroom-style brush with sliders.
 */
export function addLocalAdjustment(doc: PhotoDoc, type: LayerType | 'localBasic'): { doc: PhotoDoc; layerId: string; layerIds: string[] } {
  const types: LayerType[] = type === 'localBasic' ? ['exposure', 'tone', 'vibranceSaturation'] : [type];
  let cur = doc;
  const ids: string[] = [];
  let ref: string | null = null;
  if (type === 'localBasic') {
    ref = uniqueMaskId(cur, 'local');
    cur = { ...cur, masks: { ...cur.masks, [ref]: emptyMask() } };
  }
  for (const t of types) {
    const base = newLayer(cur, t);
    const layer = { ...base, id: uniqueLayerId(cur, t), mask: ref ? { ref } : emptyMask() } as AdjustmentLayer;
    cur = { ...cur, layers: [...cur.layers, layer] };
    ids.push(layer.id);
  }
  return { doc: cur, layerId: ids[0], layerIds: ids };
}

/** "Add red-eye": a `redEye` layer with a radial mask on a click (normalized x,y, radius as a fraction of the long side). */
export function addRedEye(doc: PhotoDoc, x: number, y: number, radiusFrac: number, outW: number, outH: number): { doc: PhotoDoc; layerId: string } {
  const long = Math.max(outW, outH);
  const base = newLayer(doc, 'redEye');
  const mask = maskSchema.parse({
    components: [{ kind: 'radial', center: { x, y }, rx: (radiusFrac * long) / outW, ry: (radiusFrac * long) / outH, feather: 0.45 }],
  });
  const layer = { ...base, mask } as AdjustmentLayer;
  return { doc: { ...doc, layers: [...doc.layers, layer] }, layerId: layer.id };
}

/** Add one colour target (eyedropper); a 9th is refused. `replace` swaps the list (plain click), shift adds. */
export function addColorTarget(doc: PhotoDoc, layerId: string, index: number, rgb: { r: number; g: number; b: number }, add: boolean): PhotoDoc {
  return editLayerMask(doc, layerId, (m) => {
    const c = m.components[index];
    if (!c || c.kind !== 'colorRange') return m;
    const colors = add ? (c.colors.length >= MAX_COLOR_TARGETS ? c.colors : [...c.colors, rgb]) : [rgb];
    return { ...m, components: m.components.map((x, i) => (i === index ? { ...c, colors } : x)) };
  });
}

// ---------------------------------------------------------------------------
// Brush payloads
// ---------------------------------------------------------------------------

export const dataUriBytes = (uri: string): number => Math.floor(((uri.length - (uri.indexOf(',') + 1)) * 3) / 4);

/** Total bytes of every brush PNG the doc carries (inline and named masks). */
export function docBrushBytes(doc: PhotoDoc): number {
  let n = 0;
  const count = (m: Mask) => m.components.forEach((c) => c.kind === 'brush' && (n += dataUriBytes(c.png)));
  doc.layers.forEach((l) => l.mask && !isMaskRef(l.mask) && count(l.mask));
  Object.values(doc.masks ?? {}).forEach(count);
  return n;
}
export const brushBudget = (doc: PhotoDoc): { bytes: number; warn: boolean; full: boolean } => {
  const bytes = docBrushBytes(doc);
  return { bytes, warn: bytes >= BRUSH_DOC_WARN_BYTES, full: bytes >= PHOTO_MAX_DOC_BYTES - 512 * 1024 };
};

/** Replace (or append) the layer's brush component with a baked PNG. */
export function setBrushComponent(doc: PhotoDoc, layerId: string, png: string, width: number, height: number, index?: number): PhotoDoc {
  return editLayerMask(doc, layerId, (m) => {
    const comp = maskComponentSchema.parse({ kind: 'brush', png, width, height });
    const at = index ?? m.components.findIndex((c) => c.kind === 'brush');
    if (at >= 0 && m.components[at]?.kind === 'brush') return { ...m, components: m.components.map((c, i) => (i === at ? { ...comp, mode: c.mode } : c)) as MaskComponent[] };
    return m.components.length >= PHOTO_MAX_MASK_COMPONENTS ? m : { ...m, components: [...m.components, comp] };
  });
}
export const brushPngTooBig = (png: string): boolean => dataUriBytes(png) > PHOTO_MAX_BRUSH_PNG_BYTES;

// ---------------------------------------------------------------------------
// Crop-change re-map (masks live in the geometry-corrected space)
// ---------------------------------------------------------------------------

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
const FULL: CropRect = { x: 0, y: 0, width: 1, height: 1 };

/** Normalized point in the OLD crop space → the NEW one. */
export function remapPoint(p: { x: number; y: number }, from: CropRect | null, to: CropRect | null): { x: number; y: number } {
  const a = from ?? FULL;
  const b = to ?? FULL;
  return { x: (a.x + p.x * a.width - b.x) / b.width, y: (a.y + p.y * a.height - b.y) / b.height };
}

/** Resample an alpha raster from the old crop space into the new one (outside = 0), bilinear. */
export function remapAlpha(img: AlphaImage, from: CropRect | null, to: CropRect | null, outW = img.width, outH = img.height): AlphaImage {
  const a = from ?? FULL;
  const b = to ?? FULL;
  const out = new Uint8Array(outW * outH);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= img.width || y >= img.height ? 0 : img.alpha[y * img.width + x] / 255);
  for (let j = 0; j < outH; j += 1) {
    for (let i = 0; i < outW; i += 1) {
      const cx = b.x + ((i + 0.5) / outW) * b.width; // canvas-normalized
      const cy = b.y + ((j + 0.5) / outH) * b.height;
      const ox = (cx - a.x) / a.width; // old-space normalized
      const oy = (cy - a.y) / a.height;
      if (ox < 0 || oy < 0 || ox > 1 || oy > 1) continue;
      const u = ox * img.width - 0.5;
      const v = oy * img.height - 0.5;
      const x0 = Math.floor(u);
      const y0 = Math.floor(v);
      const tx = u - x0;
      const ty = v - y0;
      const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
      const bot = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
      out[j * outW + i] = Math.round((top * (1 - ty) + bot * ty) * 255);
    }
  }
  return { width: outW, height: outH, alpha: out };
}

/**
 * Re-map every parametric mask component (gradient, radial) for a crop change
 * so the masks stay on the same picture content. Radial radii scale per axis
 * (an ellipse with rotation under a non-uniform scale is approximated by the
 * unrotated per-axis scale; documented). Brush PNGs are re-mapped separately
 * (async, `remapBrushes`), luminosity and colour range are pixel-driven and
 * need nothing, subject masks cover the whole space and are left alone.
 */
export function remapParametricMasks(doc: PhotoDoc, from: CropRect | null, to: CropRect | null): PhotoDoc {
  const a = from ?? FULL;
  const b = to ?? FULL;
  if (a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height) return doc;
  const fix = (m: Mask): Mask => ({
    ...m,
    components: m.components.map((c) => {
      if (c.kind === 'gradient') {
        const f = remapPoint(c.from, from, to);
        const t = remapPoint(c.to, from, to);
        return { ...c, from: { x: clampPt(f.x), y: clampPt(f.y) }, to: { x: clampPt(t.x), y: clampPt(t.y) } };
      }
      if (c.kind === 'radial') {
        const p = remapPoint(c.center, from, to);
        return { ...c, center: { x: clampPt(p.x), y: clampPt(p.y) }, rx: Math.min(2, (c.rx * a.width) / b.width), ry: Math.min(2, (c.ry * a.height) / b.height) };
      }
      return c;
    }),
  });
  return {
    ...doc,
    layers: doc.layers.map((l) => (l.mask && !isMaskRef(l.mask) ? ({ ...l, mask: fix(l.mask) } as AdjustmentLayer) : l)),
    ...(doc.masks ? { masks: Object.fromEntries(Object.entries(doc.masks).map(([k, m]) => [k, fix(m)])) } : {}),
  };
}
const clampPt = (v: number) => Math.max(-1, Math.min(2, v));

/** Every brush component in the doc (inline then named), with a setter path for re-baking. */
export function listBrushes(doc: PhotoDoc): { where: { layerId: string } | { maskId: string }; index: number; png: string; width: number; height: number }[] {
  const out: ReturnType<typeof listBrushes> = [];
  doc.layers.forEach((l) => {
    if (l.mask && !isMaskRef(l.mask)) l.mask.components.forEach((c, index) => c.kind === 'brush' && out.push({ where: { layerId: l.id }, index, png: c.png, width: c.width, height: c.height }));
  });
  Object.entries(doc.masks ?? {}).forEach(([maskId, m]) => m.components.forEach((c, index) => c.kind === 'brush' && out.push({ where: { maskId }, index, png: c.png, width: c.width, height: c.height })));
  return out;
}
export function replaceBrushPng(doc: PhotoDoc, where: { layerId: string } | { maskId: string }, index: number, png: string, width: number, height: number): PhotoDoc {
  const swap = (m: Mask): Mask => ({ ...m, components: m.components.map((c, i) => (i === index && c.kind === 'brush' ? { ...c, png, width, height } : c)) });
  if ('maskId' in where) return doc.masks?.[where.maskId] ? { ...doc, masks: { ...doc.masks, [where.maskId]: swap(doc.masks[where.maskId]) } } : doc;
  return { ...doc, layers: doc.layers.map((l) => (l.id === where.layerId && l.mask && !isMaskRef(l.mask) ? ({ ...l, mask: swap(l.mask) } as AdjustmentLayer) : l)) };
}
