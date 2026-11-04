/**
 * @jest-environment node
 *
 * SkSL parity (ticket MA50 risk "SkSL <-> GLSL drift"): every golden doc the rung-1 shader can
 * render is drawn through `buildDocShader` with real Skia (CanvasKit) and compared with the web's
 * committed golden. Tolerances are the design's §3.3 colour-op bounds (8-bit: mean <= 1.0,
 * p99 <= 2, max <= 4); alpha must be exact.
 *
 * Step functions (`posterize`, `threshold`) are discontinuous: when they run late in a long chain,
 * a pixel whose input sits within float32 error of a level boundary lands on the other level (the
 * reference is float64, Skia float32). For those docs the max bound is replaced by "at most 0.5 %
 * of pixels beyond 4", and the chain up to the first step op must meet the full bound.
 */
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { GOLDEN_IMAGES, goldenDocs, goldenPath, readImage } from '../../goldens';
import { isDetailType, renderDocCPU, toBytes } from '../../colorMath';
import { newPhotoDoc, parsePhotoDoc, type AdjustmentLayer, type PhotoDoc } from '../../photoTypes';
import { buildDocShader, effectFor, type SkiaApi } from '../shaderChain';
import { SKSL_LAYER_TYPES } from '../shaders/adjust';
import { uniformFloatCount } from '../uniforms';
import { loadSkiaApi } from '../testing/skiaTestApi';

jest.setTimeout(120_000);

const FIXTURES = `${__dirname}/../../fixtures`;

/** Docs the MA50 renderer covers: no geometry, no masks, no rung-4 layers. */
function rung1Only(doc: PhotoDoc): boolean {
  const g = doc.geometry;
  const identityGeometry =
    g.rotate === 0 && !g.flipH && !g.flipV && g.perspective === null && g.crop === null;
  return (
    identityGeometry &&
    !doc.masks &&
    doc.layers.every((l) => l.mask === null && !isDetailType(l.type))
  );
}

function render(api: SkiaApi, doc: PhotoDoc, image: string) {
  const png = PNG.sync.read(readFileSync(`${FIXTURES}/images/${image}.png`));
  const src = api.Image.MakeImage(
    { width: png.width, height: png.height, colorType: 4, alphaType: 3 },
    api.Data.fromBytes(new Uint8Array(png.data)),
    png.width * 4,
  );
  if (!src) throw new Error('source image');
  const surface = api.Surface.Make(png.width, png.height);
  if (!surface) throw new Error('surface');
  const paint = api.Paint();
  paint.setShader(buildDocShader(api, src, doc.layers, 'exact'));
  surface.getCanvas().drawRect(api.XYWHRect(0, 0, png.width, png.height), paint);
  surface.flush();
  const out = surface
    .makeImageSnapshot()
    .readPixels(0, 0, { width: png.width, height: png.height, colorType: 4, alphaType: 3 });
  if (!(out instanceof Uint8Array)) throw new Error('readPixels');
  return { out, png };
}

const STEP_TYPES = new Set(['posterize', 'threshold']);
/** Index of the first step op that follows another planned layer, or -1. */
const lateStepIndex = (layers: readonly AdjustmentLayer[]) =>
  layers.findIndex((l, i) => i > 0 && STEP_TYPES.has(l.type));

function compare(a: Uint8Array, b: ArrayLike<number>) {
  const diffs: number[] = [];
  let alphaMismatch = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] !== b[i + 3]) alphaMismatch += 1;
    // Fully transparent pixels carry no colour after premultiplication (the web's float texture
    // keeps it, an RGBA8 surface cannot); nothing on screen shows them.
    if (b[i + 3] === 0) continue;
    for (let k = 0; k < 3; k += 1) diffs.push(Math.abs(a[i + k]! - b[i + k]!));
  }
  diffs.sort((x, y) => x - y);
  const mean = diffs.reduce((s, d) => s + d, 0) / Math.max(1, diffs.length);
  const p99 = diffs[Math.floor(diffs.length * 0.99)] ?? 0;
  const max = diffs[diffs.length - 1] ?? 0;
  let beyond = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (b[i + 3] === 0) continue;
    if (
      Math.max(
        Math.abs(a[i]! - b[i]!),
        Math.abs(a[i + 1]! - b[i + 1]!),
        Math.abs(a[i + 2]! - b[i + 2]!),
      ) > 4
    )
      beyond += 1;
  }
  return { mean, p99, max, alphaMismatch, beyondFraction: beyond / (a.length / 4) };
}

const withinColourTolerance = (s: ReturnType<typeof compare>, stepTail: boolean) =>
  s.mean <= 1.0 && s.p99 <= 2 && (stepTail ? s.beyondFraction <= 0.005 : s.max <= 4);

describe('SkSL port vs the web goldens (real Skia via CanvasKit)', () => {
  let api: SkiaApi;
  beforeAll(async () => {
    api = await loadSkiaApi();
  });

  it('every rung-1 type compiles, with the uniform layout the packer fills', () => {
    for (const type of SKSL_LAYER_TYPES) {
      const e = effectFor(api, type);
      expect([type, e.getUniformFloatCount()]).toEqual([type, uniformFloatCount(type)]);
    }
  });

  const docs = goldenDocs().filter((d) => rung1Only(d.doc));

  it('covers the shared rung-1 docs and one golden doc per rung-1 type', () => {
    const names = docs.map((d) => d.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'rung1-all-layers',
        'hsl-grey-except-red',
        'curves-s',
        'levels-channels',
        'lut-invert-half',
      ]),
    );
    const types = new Set(docs.flatMap((d) => d.doc.layers.map((l) => l.type)));
    // redEye only has a masked golden (MA51); it is checked against colorMath directly below.
    for (const t of SKSL_LAYER_TYPES.filter((x) => x !== 'redEye'))
      expect([t, types.has(t)]).toEqual([t, true]);
  });

  it.each(docs.map((d) => [d.name, d.doc] as const))(
    '%s within the colour-op tolerance on all images',
    (name, doc) => {
      for (const image of GOLDEN_IMAGES) {
        const { out } = render(api, doc, image);
        const golden = PNG.sync.read(readFileSync(goldenPath(name, image)));
        const s = compare(out, new Uint8Array(golden.data));
        const label = `${name}.${image} mean=${s.mean.toFixed(3)} p99=${s.p99} max=${s.max} beyond4=${(s.beyondFraction * 100).toFixed(2)}%`;
        expect([label, s.alphaMismatch]).toEqual([label, 0]);
        expect([label, withinColourTolerance(s, lateStepIndex(doc.layers) >= 0)]).toEqual([
          label,
          true,
        ]);
      }
    },
  );

  it('rung1-all-layers up to its first step op (posterize) meets the full colour-op bound', () => {
    const r = parsePhotoDoc(readFileSync(`${FIXTURES}/docs/rung1-all-layers.json`, 'utf8'));
    if (!r.ok) throw new Error(r.error);
    const cut = lateStepIndex(r.doc.layers);
    expect(cut).toBeGreaterThan(10);
    const layers = r.doc.layers.slice(0, cut);
    for (const image of GOLDEN_IMAGES) {
      const { out } = render(api, { ...r.doc, layers }, image);
      const s = compare(out, toBytes(renderDocCPU({ layers }, readImage(image))));
      expect([image, s.max <= 4 && s.mean <= 1.0 && s.p99 <= 2]).toEqual([image, true]);
    }
  });

  it('redEye (unmasked) matches colorMath on the chart', () => {
    const parsed = parsePhotoDoc({
      ...newPhotoDoc(256, 256),
      layers: [{ id: 'eye', type: 'redEye' }],
    });
    if (!parsed.ok) throw new Error(parsed.error);
    const { out } = render(api, parsed.doc, 'chart');
    const s = compare(out, toBytes(renderDocCPU(parsed.doc, readImage('chart'))));
    expect(s.max).toBeLessThanOrEqual(1);
  });
});
