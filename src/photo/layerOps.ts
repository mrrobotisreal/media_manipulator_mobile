// DO NOT EDIT. Copied from media-manipulator-ui lib/photo/layerOps.ts by scripts/sync-photo-fixtures.mjs
// (npm run photo:sync). The web repo is the source of the model and the math (ADR MA-0010);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/**
 * Pure document edits for the layer stack (no I/O, no store). Every function
 * returns a NEW document (or the same one when nothing changed) so the store's
 * structural-sharing snapshots stay one pointer each.
 */
import { LAYER_PARAMS, type AdjustmentLayer, type HslRange, type LayerType, type PhotoDoc } from './photoTypes';

export function defaultParams<K extends LayerType>(type: K): Extract<AdjustmentLayer, { type: K }>['params'] {
  return (LAYER_PARAMS[type] as unknown as { parse(v: unknown): never }).parse({});
}

export function uniqueLayerId(doc: Pick<PhotoDoc, 'layers'>, base: string): string {
  const ids = new Set(doc.layers.map((l) => l.id));
  const stem = base.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30) || 'layer';
  if (!ids.has(stem)) return stem;
  for (let i = 2; i < 10_000; i += 1) if (!ids.has(`${stem}-${i}`)) return `${stem}-${i}`;
  return `${stem}-${Date.now()}`;
}

export function newLayer<K extends LayerType>(doc: Pick<PhotoDoc, 'layers'>, type: K): Extract<AdjustmentLayer, { type: K }> {
  return {
    id: uniqueLayerId(doc, type),
    type,
    enabled: true,
    opacity: 1,
    blend: 'normal',
    mask: null,
    params: defaultParams(type as LayerType),
  } as unknown as Extract<AdjustmentLayer, { type: K }>;
}

/**
 * Basic-panel semantics (ticket decision 9): a slider edits a layer of `type`;
 * if none exists one is created at the top of the stack on first touch. When one
 * exists ANYWHERE (not only the top) it is edited in place, so repeated drags
 * never stack duplicates. Returns the doc and the id of the layer touched.
 */
export function upsertAdjustment<K extends LayerType>(
  doc: PhotoDoc,
  type: K,
  edit: (params: Extract<AdjustmentLayer, { type: K }>['params']) => Extract<AdjustmentLayer, { type: K }>['params'],
  selectId?: string,
): { doc: PhotoDoc; id: string } {
  const existing = selectId
    ? doc.layers.find((l) => l.id === selectId && l.type === type)
    : [...doc.layers].reverse().find((l) => l.type === type);
  if (existing) {
    const params = edit(existing.params as never);
    if (params === existing.params) return { doc, id: existing.id };
    return {
      id: existing.id,
      doc: { ...doc, layers: doc.layers.map((l) => (l === existing ? ({ ...l, params } as AdjustmentLayer) : l)) },
    };
  }
  const base = newLayer(doc, type);
  const params = edit(base.params as never);
  return { id: base.id, doc: { ...doc, layers: [...doc.layers, { ...base, params } as AdjustmentLayer] } };
}

export function patchLayer(doc: PhotoDoc, id: string, patch: Partial<Omit<AdjustmentLayer, 'id' | 'type' | 'params'>>): PhotoDoc {
  let changed = false;
  const layers = doc.layers.map((l) => {
    if (l.id !== id) return l;
    const next = { ...l, ...patch } as AdjustmentLayer;
    if (patch.name === '' || patch.name === undefined) delete (next as { name?: string }).name;
    if (Object.keys(patch).every((k) => (l as unknown as Record<string, unknown>)[k] === (patch as Record<string, unknown>)[k])) return l;
    changed = true;
    return next;
  });
  return changed ? { ...doc, layers } : doc;
}

export function removeLayer(doc: PhotoDoc, id: string): PhotoDoc {
  const layers = doc.layers.filter((l) => l.id !== id);
  return layers.length === doc.layers.length ? doc : { ...doc, layers };
}

export function duplicateLayer(doc: PhotoDoc, id: string): { doc: PhotoDoc; id: string | null } {
  const i = doc.layers.findIndex((l) => l.id === id);
  if (i < 0) return { doc, id: null };
  const src = doc.layers[i];
  const copy = { ...structuredClone(src), id: uniqueLayerId(doc, src.id) } as AdjustmentLayer;
  const layers = [...doc.layers.slice(0, i + 1), copy, ...doc.layers.slice(i + 1)];
  return { doc: { ...doc, layers }, id: copy.id };
}

export function moveLayer(doc: PhotoDoc, id: string, toIndex: number): PhotoDoc {
  const from = doc.layers.findIndex((l) => l.id === id);
  if (from < 0) return doc;
  const to = Math.max(0, Math.min(doc.layers.length - 1, toIndex));
  if (from === to) return doc;
  const layers = [...doc.layers];
  const [item] = layers.splice(from, 1);
  layers.splice(to, 0, item);
  return { ...doc, layers };
}

/**
 * "Grey except this" (HSL panel): saturation -100 on every other range, 0 on
 * the chosen one. The default ranges and any custom ones are all treated alike.
 */
export function greyExcept(ranges: HslRange[], keepId: string): HslRange[] {
  return ranges.map((r) => {
    const saturation = r.id === keepId ? 0 : -100;
    return r.saturation === saturation ? r : { ...r, saturation };
  });
}

/** Add a custom range (eyedropper), centred on `hue` with the given width/feather. */
export function addCustomRange(ranges: HslRange[], hue: number, width = 20, feather = 20): { ranges: HslRange[]; id: string } {
  const ids = new Set(ranges.map((r) => r.id));
  let n = 1;
  while (ids.has(`custom-${n}`)) n += 1;
  const id = `custom-${n}`;
  const center = ((Math.round(hue) % 360) + 360) % 360;
  return { id, ranges: [...ranges, { id, center, width, feather, hue: 0, saturation: 0, lightness: 0 }] };
}
