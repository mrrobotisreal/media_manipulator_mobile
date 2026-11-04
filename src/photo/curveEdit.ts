// DO NOT EDIT. Copied from media-manipulator-ui lib/photo/curveEdit.ts by scripts/sync-photo-fixtures.mjs
// (npm run photo:sync). The web repo is the source of the model and the math (ADR MA-0010);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/**
 * Pure curve-point editing for the Curves panel. Points stay sorted with `x`
 * strictly increasing (the schema's rule); a drag that would cross a neighbour
 * is REFUSED by clamping to just short of it, so the document can never become
 * invalid mid-drag.
 */
import type { CurvePoint } from './photoTypes';

export const MIN_CURVE_GAP = 0.004;
export const MAX_CURVE_POINTS = 16;
export const IDENTITY_CURVE: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function isValidCurve(points: CurvePoint[]): boolean {
  return points.length >= 2 && points.length <= MAX_CURVE_POINTS && points.every((p, i) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 && (i === 0 || p.x > points[i - 1].x));
}

/** Move point `index` to (x, y). End points keep x (0 and 1); inner points cannot cross neighbours. */
export function movePoint(points: CurvePoint[], index: number, x: number, y: number): CurvePoint[] {
  if (index < 0 || index >= points.length) return points;
  const last = points.length - 1;
  let nx: number;
  if (index === 0) nx = points[0].x;
  else if (index === last) nx = points[last].x;
  else nx = Math.min(points[index + 1].x - MIN_CURVE_GAP, Math.max(points[index - 1].x + MIN_CURVE_GAP, clamp01(x)));
  const ny = clamp01(y);
  const cur = points[index];
  if (cur.x === nx && cur.y === ny) return points;
  return points.map((p, i) => (i === index ? { x: nx, y: ny } : p));
}

/** Insert a point (refused when it would sit within the gap of a neighbour or the curve is full). Returns the new index. */
export function insertPoint(points: CurvePoint[], x: number, y: number): { points: CurvePoint[]; index: number } {
  if (points.length >= MAX_CURVE_POINTS) return { points, index: -1 };
  const px = clamp01(x);
  const at = points.findIndex((p) => p.x >= px);
  if (at <= 0) return { points, index: -1 };
  if (points[at].x - px < MIN_CURVE_GAP || px - points[at - 1].x < MIN_CURVE_GAP) return { points, index: -1 };
  const next = [...points.slice(0, at), { x: px, y: clamp01(y) }, ...points.slice(at)];
  return { points: next, index: at };
}

/** Remove an inner point (end points and the last two points stay). */
export function removePoint(points: CurvePoint[], index: number): CurvePoint[] {
  if (index <= 0 || index >= points.length - 1 || points.length <= 2) return points;
  return points.filter((_, i) => i !== index);
}

export const isIdentityCurve = (points: CurvePoint[]) => points.length === 2 && points[0].x === 0 && points[0].y === 0 && points[1].x === 1 && points[1].y === 1;
