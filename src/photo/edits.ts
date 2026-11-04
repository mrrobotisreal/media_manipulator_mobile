/**
 * Sheet-level document edits (pure, over the copied web `layerOps`/`curveEdit`): what each control
 * in the Basic / Colour / Curves / Levels / B&W / More / Layers sheets does to the `PhotoDoc`.
 * Every function returns a new doc (or the same one when nothing changed), so the store keeps
 * one-pointer snapshots and no-op drags record nothing.
 */
import { addCustomRange, greyExcept, moveLayer, upsertAdjustment as upsertTyped } from './layerOps';
import { insertPoint, isValidCurve, movePoint } from './curveEdit';
import { setLevelsField, type LevelsField } from './levelsEdit';
import type {
  AdjustmentLayer,
  CurvePoint,
  HslRange,
  LayerType,
  LevelsChannel,
  PhotoDoc,
} from './photoTypes';

type Params<K extends LayerType> = Extract<AdjustmentLayer, { type: K }>['params'];
type AnyParams = Record<string, unknown>;

/**
 * The web's `upsertAdjustment` with a loose edit signature: its generic one does not survive the
 * union of 27 param shapes at a generic call site here. The typed per-type call sites below cast.
 */
const upsertAny = upsertTyped as unknown as (
  doc: PhotoDoc,
  type: LayerType,
  edit: (p: AnyParams) => AnyParams,
) => { doc: PhotoDoc; id: string };
function upsertAdjustment<K extends LayerType>(
  doc: PhotoDoc,
  type: K,
  edit: (p: Params<K>) => Params<K>,
): { doc: PhotoDoc; id: string } {
  return upsertAny(doc, type, edit as unknown as (p: AnyParams) => AnyParams);
}

/** Set one numeric param of the (first-or-created) layer of `type` (Basic panel semantics). */
export function setParam(doc: PhotoDoc, type: LayerType, key: string, value: number): PhotoDoc {
  return upsertAny(doc, type, (p) => (p[key] === value ? p : { ...p, [key]: value })).doc;
}

/** Set a nested numeric param (`colorBalance.shadows.r`, `splitTone.highlights.hue`…). */
export function setNested(
  doc: PhotoDoc,
  type: LayerType,
  path: [string, string],
  value: number,
): PhotoDoc {
  return upsertAny(doc, type, (p) => {
    const outer = (p[path[0]] as AnyParams | null | undefined) ?? {};
    if (outer[path[1]] === value) return p;
    return { ...p, [path[0]]: { ...outer, [path[1]]: value } };
  }).doc;
}

export function setFlag(doc: PhotoDoc, type: LayerType, key: string, value: unknown): PhotoDoc {
  return upsertAny(doc, type, (p) => (p[key] === value ? p : { ...p, [key]: value })).doc;
}

/** Read a param of the topmost layer of `type` (the one the sheets edit), or the default. */
export function paramOf(
  doc: PhotoDoc | null,
  type: LayerType,
  key: string,
  fallback: number,
): number {
  const l = doc ? [...doc.layers].reverse().find((x) => x.type === type) : undefined;
  const v = l ? (l.params as Record<string, unknown>)[key] : undefined;
  return typeof v === 'number' ? v : fallback;
}

export function nestedOf(
  doc: PhotoDoc | null,
  type: LayerType,
  path: [string, string],
  fallback: number,
): number {
  const l = doc ? [...doc.layers].reverse().find((x) => x.type === type) : undefined;
  const v = l
    ? (l.params as Record<string, Record<string, unknown> | undefined>)[path[0]]?.[path[1]]
    : undefined;
  return typeof v === 'number' ? v : fallback;
}

export const layerOfType = <K extends LayerType>(doc: PhotoDoc | null, type: K) =>
  (doc ? [...doc.layers].reverse().find((x) => x.type === type) : undefined) as
    Extract<AdjustmentLayer, { type: K }> | undefined;

// --- Colour (HSL) ---------------------------------------------------------------------------

/** The HSL layer's ranges (the six defaults when there is no HSL layer yet). */
export function hslRanges(doc: PhotoDoc | null): HslRange[] {
  const l = layerOfType(doc, 'hsl');
  if (l) return l.params.ranges;
  return (
    upsertAdjustment(
      doc ?? ({ layers: [] } as unknown as PhotoDoc),
      'hsl',
      (p) => p,
    ).doc.layers.find((x) => x.type === 'hsl') as Extract<AdjustmentLayer, { type: 'hsl' }>
  ).params.ranges;
}

export function setRange(
  doc: PhotoDoc,
  rangeId: string,
  key: 'hue' | 'saturation' | 'lightness',
  value: number,
): PhotoDoc {
  return upsertAdjustment(doc, 'hsl', (p) => {
    let changed = false;
    const ranges = p.ranges.map((r) => {
      if (r.id !== rangeId || r[key] === value) return r;
      changed = true;
      return { ...r, [key]: value };
    });
    return changed ? { ...p, ranges } : p;
  }).doc;
}

/** "Grey except this": saturation -100 on every other range, 0 on the kept one (design §5.1). */
export function greyExceptRange(doc: PhotoDoc, keepId: string): PhotoDoc {
  return upsertAdjustment(doc, 'hsl', (p) => {
    const ranges = greyExcept(p.ranges, keepId);
    return ranges.every((r, i) => r === p.ranges[i]) ? p : { ...p, ranges };
  }).doc;
}

export function addEyedropperRange(doc: PhotoDoc, hue: number): { doc: PhotoDoc; id: string } {
  let id = '';
  const next = upsertAdjustment(doc, 'hsl', (p) => {
    const r = addCustomRange(p.ranges, hue);
    id = r.id;
    return { ...p, ranges: r.ranges };
  }).doc;
  return { doc: next, id };
}

// --- Curves ---------------------------------------------------------------------------------

export type CurveChannel = 'master' | 'r' | 'g' | 'b';

export function curvePoints(doc: PhotoDoc | null, ch: CurveChannel): CurvePoint[] {
  return (
    layerOfType(doc, 'curves')?.params[ch].points ?? [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]
  );
}

function withPoints(doc: PhotoDoc, ch: CurveChannel, points: CurvePoint[]): PhotoDoc {
  return upsertAdjustment(doc, 'curves', (p) =>
    p[ch].points === points ? p : { ...p, [ch]: { ...p[ch], points } },
  ).doc;
}

/**
 * Drag a point. The monotone constraint (x strictly increasing, the schema's rule) is enforced by
 * `movePoint`: a drag past a neighbour is clamped short of it, so the doc is never invalid.
 * `refused` is true when the finger asked for an x the constraint did not allow.
 */
export function dragCurvePoint(
  doc: PhotoDoc,
  ch: CurveChannel,
  index: number,
  x: number,
  y: number,
): { doc: PhotoDoc; refused: boolean } {
  const pts = curvePoints(doc, ch);
  const next = movePoint(pts, index, x, y);
  const landed = next[index];
  const refused = !!landed && index > 0 && index < pts.length - 1 && Math.abs(landed.x - x) > 1e-9;
  if (!isValidCurve(next)) return { doc, refused: true };
  return { doc: next === pts ? doc : withPoints(doc, ch, next), refused };
}

export function addCurvePoint(
  doc: PhotoDoc,
  ch: CurveChannel,
  x: number,
  y: number,
): { doc: PhotoDoc; index: number } {
  const r = insertPoint(curvePoints(doc, ch), x, y);
  return r.index < 0 ? { doc, index: -1 } : { doc: withPoints(doc, ch, r.points), index: r.index };
}

export function resetCurve(doc: PhotoDoc, ch: CurveChannel): PhotoDoc {
  return withPoints(doc, ch, [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ]);
}

// --- Levels ---------------------------------------------------------------------------------

export function levelsOf(doc: PhotoDoc | null, ch: LevelsChannel) {
  return (
    layerOfType(doc, 'levels')?.params[ch] ?? {
      inBlack: 0,
      inWhite: 1,
      gamma: 1,
      outBlack: 0,
      outWhite: 1,
    }
  );
}

export function setLevels(
  doc: PhotoDoc,
  ch: LevelsChannel,
  field: LevelsField,
  value: number,
): PhotoDoc {
  return upsertAdjustment(doc, 'levels', (p) => {
    const next = setLevelsField(p[ch], field, value);
    return next === p[ch] ? p : { ...p, [ch]: next };
  }).doc;
}

// --- Layers ---------------------------------------------------------------------------------

/** Drag-reorder in the Layers sheet: the list shows the top of the stack first. */
export function reorderFromList(doc: PhotoDoc, id: string, listIndex: number): PhotoDoc {
  return moveLayer(doc, id, doc.layers.length - 1 - listIndex);
}

/** A layer type the More sheet adds when missing (effects are explicit layers, not sliders). */
export function addLayer(doc: PhotoDoc, type: LayerType): PhotoDoc {
  return upsertAny(doc, type, (p) => p).doc;
}
