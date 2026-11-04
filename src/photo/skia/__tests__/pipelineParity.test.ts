/**
 * @jest-environment node
 *
 * MA51 parity (ticket decision 1, acceptance 2): the Skia pipeline (geometry → masks → layers →
 * detail, `pipeline.ts`) renders every mask, geometry, red-eye and detail golden the web commits,
 * on real Skia (CanvasKit), within the design §3.3 tolerances (8-bit):
 * - colour ops (masks, red-eye): mean <= 1.0, p99 <= 2, max <= 4, alpha exact;
 * - geometry (bilinear): max <= 2 in the interior (the manifest's border excluded), alpha too;
 * - convolution / detail: mean <= 1.5, max <= 8; with noise reduction mean <= 3, max <= 12;
 * - grain: the PCG hash is bit-exact (table below); the grain golden is within 1 LSB of float32
 *   rounding on < 0.5 % of pixels.
 * CPU raster, not the phone GPU: the Device check compares by eye.
 */
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { GEOMETRY_BORDER_PX, GOLDEN_IMAGES, goldenDocs, goldenPath } from '../../goldens';
import { grainHash, isDetailType, GRAIN_SALT } from '../../colorMath';
import type { PhotoDoc } from '../../photoTypes';
import { hasGeometry } from '../../webMaskPlan';
import { PhotoPipeline } from '../pipeline';
import { GRAIN_HASH_PROBE_SKSL, seedLimbs } from '../shaders/detail';
import { brushAlphaSource, fixtureSource } from '../testing/fixtureSource';
import { loadSkiaApi } from '../testing/skiaTestApi';
import type { SkiaApi } from '../shaderChain';

jest.setTimeout(300_000);

type Kind = 'colour' | 'geometry' | 'detail' | 'nr' | 'grain';

const isMa51Doc = (d: PhotoDoc) =>
  hasGeometry(d.geometry) ||
  !!d.masks ||
  d.layers.some((l) => l.mask !== null || isDetailType(l.type) || l.type === 'redEye');

function kindOf(d: PhotoDoc): Kind {
  const types = new Set(d.layers.map((l) => l.type));
  if (types.has('noiseReduction')) return 'nr';
  if ([...types].some((t) => isDetailType(t) && t !== 'grain')) return 'detail';
  if (types.has('grain')) return 'grain';
  if (hasGeometry(d.geometry)) return 'geometry';
  return 'colour';
}

interface Stats {
  mean: number;
  p99: number;
  max: number;
  alphaMax: number;
  differing: number;
}

function compare(a: Uint8Array, b: ArrayLike<number>, w: number, h: number, border: number): Stats {
  const diffs: number[] = [];
  let alphaMax = 0;
  let differing = 0;
  let px = 0;
  for (let y = border; y < h - border; y += 1) {
    for (let x = border; x < w - border; x += 1) {
      const o = (y * w + x) * 4;
      alphaMax = Math.max(alphaMax, Math.abs(a[o + 3]! - (b[o + 3] as number)));
      // Fully transparent pixels carry no colour on screen.
      if (b[o + 3] === 0) continue;
      px += 1;
      let any = false;
      for (let k = 0; k < 3; k += 1) {
        const d = Math.abs(a[o + k]! - (b[o + k] as number));
        diffs.push(d);
        if (d) any = true;
      }
      if (any) differing += 1;
    }
  }
  diffs.sort((x, y) => x - y);
  return {
    mean: diffs.reduce((s, d) => s + d, 0) / Math.max(1, diffs.length),
    p99: diffs[Math.floor(diffs.length * 0.99)] ?? 0,
    max: diffs[diffs.length - 1] ?? 0,
    alphaMax,
    differing: differing / Math.max(1, px),
  };
}

function within(kind: Kind, s: Stats): boolean {
  switch (kind) {
    case 'colour':
      return s.mean <= 1 && s.p99 <= 2 && s.max <= 4 && s.alphaMax === 0;
    case 'geometry':
      return s.max <= 2 && s.alphaMax <= 2;
    case 'detail':
      return s.mean <= 1.5 && s.max <= 8 && s.alphaMax === 0;
    case 'nr':
      return s.mean <= 3 && s.max <= 12 && s.alphaMax === 0;
    case 'grain':
      return s.max <= 1 && s.differing <= 0.005 && s.alphaMax === 0;
  }
}

describe('MA51 Skia pipeline vs the web goldens (real Skia via CanvasKit)', () => {
  let api: SkiaApi;
  beforeAll(async () => {
    api = await loadSkiaApi();
  });

  const docs = goldenDocs().filter((d) => isMa51Doc(d.doc));

  it('covers the six ticket docs and every mask kind, geometry step and detail op', () => {
    const names = docs.map((d) => d.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'masks-all-kinds',
        'mask-colorrange-hsl',
        'geometry-rotate-crop',
        'geometry-perspective',
        'detail-all',
        'redeye',
      ]),
    );
    const kinds = new Set(
      docs.flatMap((d) =>
        [...d.doc.layers.map((l) => l.mask), ...Object.values(d.doc.masks ?? {})].flatMap((m) =>
          m && 'components' in m ? m.components.map((c) => c.kind) : [],
        ),
      ),
    );
    for (const k of ['gradient', 'radial', 'brush', 'luminosity', 'colorRange', 'subject'])
      expect([k, kinds.has(k as never)]).toEqual([k, true]);
    const types = new Set(docs.flatMap((d) => d.doc.layers.map((l) => l.type)));
    for (const t of [
      'sharpen',
      'blur',
      'noiseReduction',
      'clarity',
      'texture',
      'dehaze',
      'vignette',
      'grain',
    ])
      expect([t, types.has(t as never)]).toEqual([t, true]);
  });

  it.each(docs.map((d) => [d.name, d.doc] as const))(
    '%s within its §3.3 tolerance on all images',
    (name, doc) => {
      const kind = kindOf(doc);
      for (const image of GOLDEN_IMAGES) {
        const pipe = new PhotoPipeline(api, brushAlphaSource(api));
        const r = pipe.readPixels(fixtureSource(api, image), doc);
        if (!r) throw new Error('readPixels');
        const golden = PNG.sync.read(readFileSync(goldenPath(name, image)));
        expect([r.width, r.height]).toEqual([golden.width, golden.height]);
        const s = compare(r.pixels, golden.data, r.width, r.height, GEOMETRY_BORDER_PX[name] ?? 0);
        const label = `${name}.${image} [${kind}] mean=${s.mean.toFixed(3)} p99=${s.p99} max=${s.max} alpha=${s.alphaMax} differing=${(s.differing * 100).toFixed(2)}%`;
        expect([label, within(kind, s)]).toEqual([label, true]);
      }
    },
  );

  it('the SkSL grain hash equals colorMath.grainHash bit for bit (64 x 4 cells, five seeds)', () => {
    const effect = api.RuntimeEffect.Make(GRAIN_HASH_PROBE_SKSL);
    if (!effect) throw new Error('compile');
    for (const seed of [0, 7, 12345, 0xffffffff, (12345 ^ GRAIN_SALT) >>> 0]) {
      const surface = api.Surface.Make(128, 4);
      if (!surface) throw new Error('surface');
      const paint = api.Paint();
      paint.setShader(effect.makeShader(seedLimbs(seed)));
      surface.getCanvas().drawRect(api.XYWHRect(0, 0, 128, 4), paint);
      surface.flush();
      const px = surface
        .makeImageSnapshot()
        .readPixels(0, 0, { width: 128, height: 4, colorType: 4, alphaType: 3 }) as Uint8Array;
      const wrong: string[] = [];
      for (let y = 0; y < 4; y += 1)
        for (let x = 0; x < 64; x += 1) {
          const o = (y * 128 + 2 * x) * 4;
          const v = (px[o]! | (px[o + 1]! << 8) | (px[o + 2]! << 16) | (px[o + 4]! << 24)) >>> 0;
          if (v !== grainHash(x, y, seed)) wrong.push(`${x},${y}`);
        }
      expect([seed, wrong]).toEqual([seed, []]);
    }
  });

  it('a slider drag on a masked layer reuses the cached mask (no recompute)', () => {
    const d = docs.find((x) => x.name === 'mask-gradient-tone')!.doc;
    const pipe = new PhotoPipeline(api, brushAlphaSource(api));
    const src = fixtureSource(api, 'photo');
    pipe.render(src, d);
    const computes = pipe.maskComputes;
    const layer = d.layers[0]!;
    for (const v of [10, 20, 30]) {
      const next = {
        ...d,
        layers: [{ ...layer, params: { ...layer.params, shadows: v } } as typeof layer],
      };
      pipe.render(src, next);
    }
    expect(pipe.maskComputes).toBe(computes);
  });
});
