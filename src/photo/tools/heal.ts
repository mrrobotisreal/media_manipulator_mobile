/**
 * The Heal press on the phone (ticket MA51 decision 5; web `healFlow.ts` + `heal-panel.tsx`).
 *
 * Spot strokes are recorded in display-normalized coordinates (the geometry-corrected preview the
 * user paints on) and mapped back through the inverse geometry into SOURCE pixels, like the web's
 * `HealStrokes`. The difference: the API checks the mask's size against the current base
 * (`healMask`: 400 `photo_mask_size` otherwise), so the phone renders the mask at EXACTLY the base
 * size (the original, or the last heal's `width`/`height`) instead of the web's capped raster.
 * That base-sized surface is memory-checked: over 50 MP the press is refused with a message.
 *
 * Flow: refuse checks → render the mask PNG (Skia, injected) → `POST …/heal` → poll the job →
 * the caller downloads the new proxy, swaps the canvas source, then appends `{id, maskRef,
 * baseRef}` to `doc.heals` in ONE `mutate('Heal')` (undo pops it and the source swaps back).
 */
import type { MmError } from '@/api/errors';
import { geometrySourcePoint, planGeometry } from '../colorMath';
import { appendHeal, baseHashOf, currentBaseRef } from '../healOps';
import type { Geometry, PhotoDoc } from '../photoTypes';
import { startHeal, waitForHeal, type AiDeps, type HealOutcome } from '../aiApi';
import type { Point } from './canvasMath';

/** Refuse base-resolution heal masks above this (a 50 MP RGBA surface is ~200 MB). */
export const HEAL_MAX_MASK_MP = 50;
/** Spot brush hardness (the web's `HealStrokes`). */
export const HEAL_HARDNESS = 80;

export interface HealStroke {
  /** Display-normalized points (0..1 of the geometry-corrected preview). */
  pts: Point[];
  /** Diameter in displayed-image (output) pixels. */
  size: number;
}

export interface MaskSize {
  width: number;
  height: number;
}

/** The size the heal mask must have: the current base (last heal with a size) or the original. */
export function healMaskSize(doc: PhotoDoc, bases: Readonly<Record<string, MaskSize>>): MaskSize {
  const ref = currentBaseRef(doc);
  const known = ref ? bases[ref] : undefined;
  return known ?? { width: doc.source.width, height: doc.source.height };
}

export type HealRefusal = 'no_strokes' | 'no_project' | 'too_large' | 'unavailable' | 'local_base';

export function healRefusal(
  doc: PhotoDoc,
  projectId: string | null,
  strokes: number,
  size: MaskSize,
  available: boolean,
): HealRefusal | null {
  if (!available) return 'unavailable';
  if (!projectId) return 'no_project';
  if (strokes === 0) return 'no_strokes';
  // A guest's local base cannot be healed on the project route.
  const ref = currentBaseRef(doc);
  if (ref && ref.startsWith('local:')) return 'local_base';
  if ((size.width * size.height) / 1_000_000 > HEAL_MAX_MASK_MP) return 'too_large';
  return null;
}

/**
 * Strokes in mask (base) pixels: each display point through the inverse geometry (crop →
 * perspective → flip → rotate) into the source, scaled from the source the doc describes to the
 * base's size; the diameter scaled by the same factor and the output→source zoom.
 */
export function strokesInMaskSpace(
  strokes: readonly HealStroke[],
  geometry: Geometry,
  source: MaskSize,
  out: MaskSize,
  mask: MaskSize,
): { pts: Point[]; diameter: number }[] {
  const plan = planGeometry(geometry, source.width, source.height);
  const kx = mask.width / source.width;
  const ky = mask.height / source.height;
  // Output pixels per source pixel of the geometry (crop / rotate keep the pixel scale).
  return strokes.map((s) => ({
    pts: s.pts.map((p) => {
      const [sx, sy] = geometrySourcePoint(plan, p.x * out.width - 0.5, p.y * out.height - 0.5);
      return { x: sx * kx, y: sy * ky };
    }),
    diameter: Math.max(1, s.size * Math.sqrt(kx * ky)),
  }));
}

export interface HealDeps {
  ai: AiDeps;
  /** Render the strokes as an opaque black/white PNG at `size`, written to a local file; its uri. */
  renderMask: (strokes: { pts: Point[]; diameter: number }[], size: MaskSize) => Promise<string>;
}

export type HealResult =
  | { ok: true; outcome: HealOutcome; doc: (d: PhotoDoc) => PhotoDoc }
  | { ok: false; error: MmError };

/** Upload the mask, wait for the job; the doc edit is returned for the caller's single mutate. */
export async function runHeal(
  deps: HealDeps,
  req: {
    projectId: string;
    doc: PhotoDoc;
    strokes: readonly HealStroke[];
    out: MaskSize;
    mask: MaskSize;
    onProgress?: (p: number) => void;
    signal?: AbortSignal;
  },
): Promise<HealResult> {
  const mapped = strokesInMaskSpace(
    req.strokes,
    req.doc.geometry,
    { width: req.doc.source.width, height: req.doc.source.height },
    req.out,
    req.mask,
  );
  let uri: string;
  try {
    uri = await deps.renderMask(mapped, req.mask);
  } catch {
    return {
      ok: false,
      error: { status: 'PARSE_ERROR', code: 'api:photo_mask_invalid', details: {} },
    };
  }
  const base = baseHashOf(currentBaseRef(req.doc));
  const started = await startHeal(deps.ai, req.projectId, uri, base);
  if (!started.ok) return started;
  const done = await waitForHeal(deps.ai, started.value, {
    onProgress: req.onProgress,
    signal: req.signal,
  });
  if (!done.ok) return done;
  const o = done.value;
  return {
    ok: true,
    outcome: o,
    doc: (d) => appendHeal(d, { baseRef: o.baseRef, maskRef: o.maskRef }),
  };
}
