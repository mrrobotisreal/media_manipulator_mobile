// DO NOT EDIT. Copied from media-manipulator-ui lib/photo/goldens.ts by scripts/sync-photo-fixtures.mjs
// (npm run photo:sync). The web repo is the source of the model and the math (ADR MA-0010);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/**
 * Golden generation shared by `scripts/photo-goldens.ts` and the equality test.
 *
 * Goldens are `<doc>.<image>.png` (8-bit RGBA) produced by `renderDocCPU` from
 * the three fixture images. The doc set is (a) the shared canonical fixtures
 * that MM97's reference renderer fully covers (identity geometry, no masks, no
 * detail ops; MM98/MM99 add the rest) and (b) one `golden-docs/*.json` per
 * rung-1 type authored here (UI is the source; the API copies them with the
 * goldens).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';

import { fromBytes, renderDocCPU, toBytes, type AlphaImage, type FloatImage, type MaskAssets } from './colorMath';
import { canonicalPhotoDoc, parsePhotoDoc, type PhotoDoc } from './photoTypes';

const DIR = join(__dirname, 'fixtures');
export const FIXTURES_ROOT = DIR;
export const GOLDEN_IMAGES = ['photo', 'chart', 'alpha'] as const;
/** Shared canonical fixtures the MM97 renderer covers completely. */
export const SHARED_GOLDEN_DOCS = [
  'blank',
  'defaults',
  'curves-s',
  'hsl-grey-except-red',
  'levels-channels',
  'rung1-all-layers',
  // MM98: masks and geometry
  'masks-all-kinds',
  'masks-named',
  'geometry-rotate-crop',
  'geometry-perspective',
  // MM99: detail operations
  'detail-all',
];
/** Golden docs whose output is geometry-resampled: comparisons exclude this many px at every output edge. */
export const GEOMETRY_BORDER_PX: Record<string, number> = { 'geometry-rotate-crop': 2, 'geometry-perspective': 2, 'geometry-straighten-edge': 2 };

export function readImage(name: string): FloatImage {
  const png = PNG.sync.read(readFileSync(join(DIR, 'images', `${name}.png`)));
  return fromBytes(png.width, png.height, png.data);
}

export function goldenDocs(): { name: string; doc: PhotoDoc }[] {
  const out: { name: string; doc: PhotoDoc }[] = [];
  const load = (path: string, name: string) => {
    const r = parsePhotoDoc(readFileSync(path, 'utf8'));
    if (!r.ok) throw new Error(`golden doc ${name}: ${r.error}`);
    out.push({ name, doc: r.doc });
  };
  for (const n of SHARED_GOLDEN_DOCS) load(join(DIR, 'docs', `${n}.json`), n);
  const extra = join(DIR, 'golden-docs');
  for (const f of readdirSync(extra).filter((x) => x.endsWith('.json')).sort()) load(join(extra, f), f.replace(/\.json$/, ''));
  return out;
}

/** Decode a `data:image/png;base64,` brush into its alpha raster (the mask value). */
export function brushAlpha(dataUri: string): AlphaImage | null {
  const m = /^data:image\/png;base64,(.*)$/.exec(dataUri);
  if (!m) return null;
  const png = PNG.sync.read(Buffer.from(m[1], 'base64'));
  const alpha = new Uint8Array(png.width * png.height);
  for (let i = 0; i < alpha.length; i += 1) alpha[i] = png.data[i * 4 + 3];
  return { width: png.width, height: png.height, alpha };
}

/**
 * Mask pixel sources for the goldens: brush PNGs are decoded; `subject`
 * masks have no pixels in the fixtures (server files), so those components
 * are skipped, identically in every renderer.
 */
export const GOLDEN_ASSETS: MaskAssets = { brush: brushAlpha, subject: () => null };

export function renderGolden(doc: PhotoDoc, image: string): Buffer {
  const src = readImage(image);
  const out = renderDocCPU(doc, src, GOLDEN_ASSETS);
  const png = new PNG({ width: out.width, height: out.height });
  png.data = Buffer.from(toBytes(out));
  return PNG.sync.write(png, { colorType: 6 });
}

export const goldenPath = (doc: string, image: string) => join(DIR, 'goldens', `${doc}.${image}.png`);
export const goldenDocPath = (name: string) => join(DIR, 'golden-docs', `${name}.json`);

/** Extra single-purpose docs (UI-authored). Keys are file names. */
export const EXTRA_DOC_LAYERS: Record<string, { id: string; type: string; params?: unknown; blend?: string; opacity?: number }[]> = {
  'exposure-plus1': [{ id: 'l1', type: 'exposure', params: { ev: 1 } }],
  'brightness-contrast': [{ id: 'l1', type: 'brightnessContrast', params: { brightness: 20, contrast: 30 } }],
  'tone-shadows-up': [{ id: 'l1', type: 'tone', params: { shadows: 60, highlights: -40, whites: 20, blacks: -20 } }],
  'white-balance-warm': [{ id: 'l1', type: 'whiteBalance', params: { temperature: 40, tint: -15 } }],
  'vibrance-saturation': [{ id: 'l1', type: 'vibranceSaturation', params: { vibrance: 50, saturation: 20 } }],
  'hsl-shift-blues': [
    {
      id: 'l1',
      type: 'hsl',
      params: {
        ranges: [
          { id: 'reds', center: 0 },
          { id: 'yellows', center: 60 },
          { id: 'greens', center: 120 },
          { id: 'cyans', center: 180 },
          { id: 'blues', center: 240, hue: 40, saturation: 30, lightness: -20 },
          { id: 'magentas', center: 300 },
        ],
      },
    },
  ],
  'color-balance-teal-orange': [
    {
      id: 'l1',
      type: 'colorBalance',
      params: { shadows: { r: -20, g: 5, b: 25 }, midtones: { r: 5, g: 0, b: -5 }, highlights: { r: 25, g: 10, b: -20 } },
    },
  ],
  'black-white-default': [{ id: 'l1', type: 'blackWhite' }],
  'black-white-red-filter': [{ id: 'l1', type: 'blackWhite', params: { reds: 200, yellows: 120, blues: -60, tint: { hue: 40, saturation: 30 } } }],
  'channel-mixer-swap': [
    { id: 'l1', type: 'channelMixer', params: { r: { r: 0, g: 0, b: 100 }, b: { r: 100, g: 0, b: 0 }, g: { constant: 5 } } },
  ],
  'channel-mixer-mono': [{ id: 'l1', type: 'channelMixer', params: { r: { r: 30, g: 59, b: 11 }, monochrome: true } }],
  'photo-filter-cooling': [{ id: 'l1', type: 'photoFilter', params: { color: '#0A5DC8', density: 40 } }],
  'split-tone-teal-orange': [{ id: 'l1', type: 'splitTone', params: { shadows: { hue: 200, saturation: 40 }, highlights: { hue: 35, saturation: 40 }, balance: -20 } }],
  'lut-invert-half': [
    {
      id: 'l1',
      type: 'lut',
      params: { cube: 'LUT_3D_SIZE 2\n1 1 1\n0 1 1\n1 0 1\n0 0 1\n1 1 0\n0 1 0\n1 0 0\n0 0 0\n', intensity: 0.5 },
    },
  ],
  'posterize-4': [{ id: 'l1', type: 'posterize', params: { levels: 4 } }],
  'threshold-half': [{ id: 'l1', type: 'threshold', params: { level: 0.5 } }],
  'invert-gamma': [{ id: 'l1', type: 'invert' }, { id: 'l2', type: 'gamma', params: { gamma: 1.8 } }],
  // MM99 detail ops
  'sharpen-only': [{ id: 'l1', type: 'sharpen', params: { amount: 200, radius: 1.2, threshold: 2 } }],
  'vignette-grain': [
    { id: 'l1', type: 'vignette', params: { amount: -60, midpoint: 40, roundness: -30, feather: 55, highlights: 30 } },
    { id: 'l2', type: 'grain', params: { amount: 40, size: 1, roughness: 0, seed: 7 } },
  ],
  'grain-only': [{ id: 'l1', type: 'grain', params: { amount: 60, size: 2, roughness: 80, seed: 4000000000 } }],
  'dehaze-negative': [{ id: 'l1', type: 'dehaze', params: { amount: -50 } }],
  'clarity-texture-blur': [
    { id: 'l1', type: 'clarity', params: { amount: 60 } },
    { id: 'l2', type: 'texture', params: { amount: 50 } },
    { id: 'l3', type: 'blur', params: { radius: 3 } },
  ],
  'opacity-and-blend': [
    { id: 'l1', type: 'exposure', params: { ev: 1.5 }, blend: 'luminosity', opacity: 0.6 },
    { id: 'l2', type: 'hsl', params: { master: { hue: 90, saturation: 20 } }, blend: 'color', opacity: 0.8 },
  ],
};

/** A deterministic RGBA PNG data URI whose alpha is `fn(x, y)` in [0,1] (brush fixtures). */
export function makeBrushPng(width: number, height: number, fn: (x: number, y: number) => number): string {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      png.data[o] = 255;
      png.data[o + 1] = 255;
      png.data[o + 2] = 255;
      png.data[o + 3] = Math.round(Math.max(0, Math.min(1, fn(x, y))) * 255);
    }
  }
  return `data:image/png;base64,${PNG.sync.write(png, { colorType: 6 }).toString('base64')}`;
}

const REDEYE_MASK = { components: [{ kind: 'radial', center: { x: 0.5, y: 0.5 }, rx: 0.12, ry: 0.12, feather: 0.4 }] };

/** Extra golden docs with masks/geometry (MM98); full doc bodies minus version/source. */
export const EXTRA_FULL_DOCS: Record<string, () => Record<string, unknown>> = {
  'mask-gradient-tone': () => ({
    layers: [
      {
        id: 'sky',
        type: 'tone',
        params: { shadows: 60, highlights: -50 },
        mask: { components: [{ kind: 'gradient', from: { x: 0.5, y: 0.1 }, to: { x: 0.5, y: 0.6 }, feather: 0.1 }] },
      },
    ],
  }),
  'mask-colorrange-hsl': () => ({
    layers: [
      {
        id: 'grey',
        type: 'hsl',
        params: { master: { saturation: -100 } },
        mask: { components: [{ kind: 'colorRange', colors: [{ r: 220, g: 40, b: 40 }], fuzziness: 50 }], invert: true },
      },
    ],
  }),
  'mask-brush-exposure': () => ({
    layers: [
      {
        id: 'dodge',
        type: 'exposure',
        params: { ev: 1.2 },
        mask: {
          feather: 6,
          components: [
            {
              kind: 'brush',
              png: makeBrushPng(16, 12, (x, y) => (Math.hypot(x - 7.5, y - 5.5) < 5 ? 1 - Math.hypot(x - 7.5, y - 5.5) / 6 : 0)),
              width: 16,
              height: 12,
            },
          ],
        },
      },
    ],
  }),
  'mask-luminosity-curves': () => ({
    layers: [
      {
        id: 'hi',
        type: 'curves',
        params: { master: { points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.35 }, { x: 1, y: 1 }] } },
        mask: { components: [{ kind: 'luminosity', lo: 0.55, hi: 1, feather: 0.15 }], feather: 2 },
      },
    ],
  }),
  redeye: () => ({ layers: [{ id: 'eye', type: 'redEye', mask: REDEYE_MASK }] }),
  'mask-radial-subtract': () => ({
    layers: [
      {
        id: 'vig',
        type: 'exposure',
        params: { ev: -1 },
        mask: {
          opacity: 0.75,
          components: [
            { kind: 'gradient', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
            { kind: 'radial', mode: 'subtract', center: { x: 0.5, y: 0.5 }, rx: 0.25, ry: 0.35, rotate: 30, feather: 0.6 },
          ],
        },
      },
    ],
  }),
  'geometry-straighten-edge': () => ({
    geometry: { rotate: 12, fill: 'edge', crop: { x: 0.05, y: 0.05, width: 0.9, height: 0.9 } },
    layers: [{ id: 'l1', type: 'exposure', params: { ev: 0.3 }, mask: { components: [{ kind: 'radial', feather: 0.5 }] } }],
  }),
  'geometry-flip-fill-colour': () => ({ geometry: { rotate: 30, flipV: true, fill: '#336699' }, layers: [] }),
};

export function buildFullDoc(body: Record<string, unknown>, source = { width: 256, height: 192 }): PhotoDoc {
  const r = parsePhotoDoc({ version: 1, source, ...body });
  if (!r.ok) throw new Error(r.error);
  return r.doc;
}

export function buildExtraDoc(layers: (typeof EXTRA_DOC_LAYERS)[string]): PhotoDoc {
  const r = parsePhotoDoc({ version: 1, source: { width: 256, height: 192 }, layers });
  if (!r.ok) throw new Error(r.error);
  return r.doc;
}

export { canonicalPhotoDoc };
