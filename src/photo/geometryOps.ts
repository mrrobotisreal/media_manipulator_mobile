// DO NOT EDIT. Copied from media-manipulator-ui lib/photo/geometryOps.ts by scripts/sync-photo-fixtures.mjs
// (npm run photo:sync). The web repo is the source of the model and the math (ADR MA-0010);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/**
 * Geometry edits (MM98): doc mutations for rotate/flip/fill/perspective/crop,
 * including the crop-change re-map of every mask coordinate and brush PNG
 * (masks are stored in the geometry-corrected space, ticket risk 2).
 */
import { geometryOutputSize, type AlphaImage } from './colorMath';
import { canvasPngEncoder, type PngEncoder } from './brushEngine';
import { getCachedAlpha, loadBrushAlpha, setCachedAlpha } from './maskAssets';
import { listBrushes, remapAlpha, remapParametricMasks, replaceBrushPng, type CropRect } from './maskOps';
import { normalizeCrop } from './toolMath';
import type { Geometry, PhotoDoc } from './photoTypes';

export const patchGeometry = (doc: PhotoDoc, patch: Partial<Geometry>): PhotoDoc => {
  const g = { ...doc.geometry, ...patch };
  return (Object.keys(patch) as (keyof Geometry)[]).every((k) => doc.geometry[k] === g[k]) ? doc : { ...doc, geometry: g };
};

/** 90-degree steps add to the rotation, wrapped into (-360, 360). */
export function rotateBy(doc: PhotoDoc, deg: number): PhotoDoc {
  let r = doc.geometry.rotate + deg;
  while (r > 360) r -= 360;
  while (r < -360) r += 360;
  return patchGeometry(doc, { rotate: Math.round(r * 100) / 100 });
}

/** Crop of the displayed canvas, or null. */
export const cropOf = (doc: PhotoDoc): CropRect | null => doc.geometry.crop;

/**
 * Change the crop and keep masks on the same picture content: parametric masks
 * are re-mapped immediately, brush PNGs are re-sampled into the new crop space
 * (async decode + encode) in the SAME document edit. The result is one
 * `PhotoDoc` ready for a single `mutate`.
 */
export async function applyCropRemap(doc: PhotoDoc, next: CropRect | null, encode: PngEncoder = canvasPngEncoder, load: (png: string) => Promise<AlphaImage | null> = loadBrushAlpha): Promise<PhotoDoc> {
  const from = doc.geometry.crop;
  const to = next ? normalizeCrop(next) : null;
  let out = patchGeometry(doc, { crop: to });
  out = remapParametricMasks(out, from, to);
  const same = (a: CropRect | null, b: CropRect | null) => (!a && !b) || (!!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);
  if (same(from, to)) return out;
  for (const b of listBrushes(out)) {
    const img = getCachedAlpha(b.png) ?? (await load(b.png));
    if (!img) continue;
    const re = remapAlpha(img, from, to, b.width, b.height);
    const rgba = new Uint8ClampedArray(re.width * re.height * 4);
    for (let i = 0; i < re.alpha.length; i += 1) {
      rgba[i * 4] = 255;
      rgba[i * 4 + 1] = 255;
      rgba[i * 4 + 2] = 255;
      rgba[i * 4 + 3] = re.alpha[i] as number;
    }
    const png = await encode(rgba, re.width, re.height);
    setCachedAlpha(png, re);
    out = replaceBrushPng(out, b.where, b.index, png, re.width, re.height);
  }
  return out;
}

export const outputSize = (doc: PhotoDoc, sourceW: number, sourceH: number) => geometryOutputSize(doc.geometry, sourceW, sourceH);
