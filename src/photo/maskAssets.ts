// DO NOT EDIT. Copied from media-manipulator-ui lib/photo/maskAssets.ts by scripts/sync-photo-fixtures.mjs
// (npm run photo:sync). The web repo is the source of the model and the math (ADR MA-0010);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/**
 * Pixels behind brush and subject mask components (MM98). The doc carries a
 * brush as a PNG data URI and a subject as a server file ref; the renderers
 * need decoded 8-bit alpha rasters. This module decodes and caches them (the
 * decode needs a browser; tests inject `AlphaImage`s directly).
 *
 *   - brush: `data:image/png;base64,…` → alpha channel
 *   - subject: `masks/<id>.png` → luminance of the PNG (the server writes a
 *     grey/alpha cut-out; its alpha when it has one, else red)
 *
 * Guests keep subject masks locally (`registerSubjectMask`), signed-in users
 * load them from the project's file route.
 */
import type { AlphaImage, MaskAssets } from './colorMath';
import type { Mask, PhotoDoc } from './photoTypes';
import { resolveLayerMask } from './colorMath';

const cache = new Map<string, AlphaImage>();
const blobs = new Map<string, Blob>();
const inflight = new Map<string, Promise<AlphaImage | null>>();
const MAX_CACHE = 48;

function remember(id: string, a: AlphaImage): AlphaImage {
  cache.set(id, a);
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string);
  return a;
}

export const getCachedAlpha = (id: string): AlphaImage | null => cache.get(id) ?? null;
export const setCachedAlpha = (id: string, a: AlphaImage): void => void remember(id, a);
export const clearMaskAssets = (): void => {
  cache.clear();
  blobs.clear();
  inflight.clear();
};

/** Alpha channel (or, for opaque greys, the red channel) of RGBA bytes. */
export function alphaFromRgba(width: number, height: number, rgba: ArrayLike<number>, preferAlpha = true): AlphaImage {
  const n = width * height;
  const alpha = new Uint8Array(n);
  let anyAlpha = false;
  if (preferAlpha) for (let i = 0; i < n && !anyAlpha; i += 1) if (rgba[i * 4 + 3] !== 255) anyAlpha = true;
  for (let i = 0; i < n; i += 1) alpha[i] = preferAlpha && anyAlpha ? rgba[i * 4 + 3] : preferAlpha ? rgba[i * 4 + 3] : rgba[i * 4];
  return { width, height, alpha };
}

async function decodeBlob(blob: Blob, brush: boolean): Promise<AlphaImage | null> {
  try {
    const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    // A brush stores coverage in alpha. A subject cut-out stores it in alpha when the PNG is
    // transparent anywhere, otherwise in the (grey) red channel.
    let transparent = false;
    for (let i = 3; i < d.length && !transparent; i += 4) if (d[i] !== 255) transparent = true;
    return alphaFromRgba(bmp.width, bmp.height, d, brush || transparent);
  } catch {
    return null;
  }
}

/** Decode a brush PNG data URI (cached). */
export function loadBrushAlpha(dataUri: string): Promise<AlphaImage | null> {
  const hit = cache.get(dataUri);
  if (hit) return Promise.resolve(hit);
  const run = inflight.get(dataUri);
  if (run) return run;
  const p = (async () => {
    try {
      const blob = await (await fetch(dataUri)).blob();
      const a = await decodeBlob(blob, true);
      return a ? remember(dataUri, a) : null;
    } finally {
      inflight.delete(dataUri);
    }
  })();
  inflight.set(dataUri, p);
  return p;
}

/** Keep a subject mask's PNG (a guest's stateless result, or a just-fetched server mask). */
export function registerSubjectMask(maskRef: string, blob: Blob): void {
  blobs.set(maskRef, blob);
  cache.delete(maskRef);
}
export const subjectMaskBlob = (maskRef: string): Blob | null => blobs.get(maskRef) ?? null;

/** Decode a subject mask: a registered blob first, else `fetchBlob(maskRef)` (the project file route). */
export function loadSubjectAlpha(maskRef: string, fetchBlob?: (ref: string) => Promise<Blob>): Promise<AlphaImage | null> {
  const hit = cache.get(maskRef);
  if (hit) return Promise.resolve(hit);
  const run = inflight.get(maskRef);
  if (run) return run;
  const p = (async () => {
    try {
      const blob = blobs.get(maskRef) ?? (fetchBlob ? await fetchBlob(maskRef) : null);
      if (!blob) return null;
      blobs.set(maskRef, blob);
      const a = await decodeBlob(blob, false);
      return a ? remember(maskRef, a) : null;
    } catch {
      return null;
    } finally {
      inflight.delete(maskRef);
    }
  })();
  inflight.set(maskRef, p);
  return p;
}

/** The ids (brush PNG / subject maskRef) a mask needs decoded. */
export function maskAssetIds(mask: Mask): { id: string; kind: 'brush' | 'subject' }[] {
  const out: { id: string; kind: 'brush' | 'subject' }[] = [];
  for (const c of mask.components) {
    if (c.kind === 'brush') out.push({ id: c.png, kind: 'brush' });
    else if (c.kind === 'subject') out.push({ id: c.maskRef, kind: 'subject' });
  }
  return out;
}

/** Every distinct pixel-backed asset a document's layers use. */
export function docAssetIds(doc: Pick<PhotoDoc, 'layers' | 'masks'>): { id: string; kind: 'brush' | 'subject' }[] {
  const seen = new Set<string>();
  const out: { id: string; kind: 'brush' | 'subject' }[] = [];
  for (const l of doc.layers) {
    const m = resolveLayerMask(doc, l);
    if (!m) continue;
    for (const a of maskAssetIds(m)) if (!seen.has(a.id)) (seen.add(a.id), out.push(a));
  }
  return out;
}

/** Load every asset a document needs; resolves with how many were newly decoded. */
export async function ensureDocAssets(doc: Pick<PhotoDoc, 'layers' | 'masks'>, fetchBlob?: (ref: string) => Promise<Blob>): Promise<AlphaImage[]> {
  const ids = docAssetIds(doc);
  const out = await Promise.all(ids.map((a) => (a.kind === 'brush' ? loadBrushAlpha(a.id) : loadSubjectAlpha(a.id, fetchBlob))));
  return out.filter((x): x is AlphaImage => !!x);
}

/** `MaskAssets` for `renderMaskCPU` / `renderDocCPU` from the cache. */
export const cachedMaskAssets: MaskAssets = {
  brush: (png) => cache.get(png) ?? null,
  subject: (ref) => cache.get(ref) ?? null,
};
