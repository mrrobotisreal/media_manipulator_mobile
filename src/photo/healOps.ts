// DO NOT EDIT. Copied from media-manipulator-ui lib/photo/healOps.ts by scripts/sync-photo-fixtures.mjs
// (npm run photo:sync). The web repo is the source of the model and the math (ADR MA-0010);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/**
 * Heal bookkeeping (MM98 decision 5 + coordinator D2): the doc entry, the
 * "current base" a renderer starts from, and the heal-stroke raster in SOURCE
 * space (strokes are painted on the displayed, geometry-corrected image and
 * mapped back through the geometry so the mask matches the base pixels).
 */
import { geometrySourcePoint, planGeometry } from './colorMath';
import { BrushRaster, brushRasterSize } from './brushEngine';
import type { Geometry, PhotoDoc } from './photoTypes';

export type HealEntry = PhotoDoc['heals'][number];

export function uniqueHealId(doc: Pick<PhotoDoc, 'heals'>): string {
  const ids = new Set(doc.heals.map((h) => h.id));
  for (let i = doc.heals.length + 1; i < 10_000; i += 1) if (!ids.has(`heal-${i}`)) return `heal-${i}`;
  return `heal-${Date.now()}`;
}

export function appendHeal(doc: PhotoDoc, entry: Omit<HealEntry, 'id'> & { id?: string }): PhotoDoc {
  if (!entry.maskRef && !entry.baseRef) return doc;
  return { ...doc, heals: [...doc.heals, { ...entry, id: entry.id ?? uniqueHealId(doc) } as HealEntry] };
}

/** The latest heal entry that carries a base (the renderers' source). */
export function currentBaseRef(doc: Pick<PhotoDoc, 'heals'>): string | null {
  for (let i = doc.heals.length - 1; i >= 0; i -= 1) if (doc.heals[i].baseRef) return doc.heals[i].baseRef as string;
  return null;
}

export const isLocalBase = (ref: string | null): boolean => !!ref && ref.startsWith('local:');
/** `bases/<hash>.png` → `<hash>`; a local marker → its id. */
export const baseHashOf = (ref: string | null): string | undefined => (ref ? ref.replace(/^bases\//, '').replace(/^local:/, '').replace(/\.png$/, '') : undefined);

/**
 * A heal-stroke recorder. `addStroke` takes points in DISPLAY-normalized
 * coordinates (0..1 of the geometry-corrected image) and stamps them into a
 * raster in source space.
 */
export class HealStrokes {
  readonly raster: BrushRaster;
  readonly strokes: { pts: { x: number; y: number }[]; size: number }[] = [];
  private readonly scale: number;
  constructor(
    private readonly geometry: Geometry,
    private readonly srcW: number,
    private readonly srcH: number,
    private readonly outW: number,
    private readonly outH: number,
  ) {
    const r = brushRasterSize(srcW, srcH, 4096);
    this.raster = new BrushRaster(r.width, r.height);
    this.scale = r.scale;
  }
  get count(): number {
    return this.strokes.length;
  }
  /** `sizeOut` is the brush diameter in displayed-image pixels. */
  addStroke(pts: { x: number; y: number }[], sizeOut: number): void {
    if (pts.length === 0) return;
    this.strokes.push({ pts, size: sizeOut });
    const plan = planGeometry(this.geometry, this.srcW, this.srcH);
    const map = (p: { x: number; y: number }) => {
      const [sx, sy] = geometrySourcePoint(plan, p.x * this.outW - 0.5, p.y * this.outH - 0.5);
      return { x: sx * this.scale, y: sy * this.scale };
    };
    const d = sizeOut * this.scale;
    const settings = { hardness: 80, flow: 100, erase: false } as const;
    if (pts.length === 1) this.raster.stamp(map(pts[0]).x, map(pts[0]).y, d, settings);
    else for (let i = 1; i < pts.length; i += 1) this.raster.stroke(map(pts[i - 1]), map(pts[i]), d, settings);
  }
  clear(): void {
    this.strokes.length = 0;
    this.raster.alpha.fill(0);
    this.raster.dirty = false;
  }
  /** Binary-ish mask bytes (white where painted) at the raster size. */
  maskRgba(): { width: number; height: number; data: Uint8ClampedArray } {
    const { width, height, alpha } = this.raster;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < alpha.length; i += 1) {
      const v = alpha[i] > 0.05 ? 255 : 0;
      data[i * 4] = v;
      data[i * 4 + 1] = v;
      data[i * 4 + 2] = v;
      data[i * 4 + 3] = 255;
    }
    return { width, height, data };
  }
}
