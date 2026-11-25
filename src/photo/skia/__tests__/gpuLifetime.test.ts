/**
 * @jest-environment node
 *
 * MA60 (S25 device check): on react-native-skia 3 the pipeline's surfaces, intermediate images and
 * pictures are GPU textures that the GC does not reclaim in time (v3 reports a texture's size only
 * on the image/surface wrapper; the shaders, paints and pictures that pin it report ~256 bytes).
 * Every one must have an owner that disposes it. Counted on CanvasKit through a proxy API
 * (`countingApi`: surfaces, images, pictures, shaders, paints, image filters): after N renders of a
 * doc with a dehaze layer and a changing upstream adjustment, the live count stays bounded by the
 * caches' caps plus the shown and the next render, and drops to zero once the pipeline is disposed.
 *
 * The phone measured the shader case (2026-11-25): with surfaces/images/pictures disposed (dc6d8d3)
 * Graphics still grew ~1 GB per dehaze slider burst, and a forced Hermes GC freed it, i.e. the
 * texture was pinned by undisposed shader wrappers (`exact(...)`, the runtime shaders of the chain).
 */
import { newPhotoDoc, parsePhotoDoc, type PhotoDoc } from '../../photoTypes';
import { PhotoPipeline } from '../pipeline';
import { recordDocPicture, renderDocPixels } from '../render';
import { countingApi, type Counts } from '../testing/countingApi';
import { fixtureSource } from '../testing/fixtureSource';
import { loadSkiaApi } from '../testing/skiaTestApi';
import type { SkiaApi } from '../shaderChain';

jest.setTimeout(120_000);

let base: SkiaApi;
beforeAll(async () => {
  base = await loadSkiaApi();
});

function doc(ev: number, extra: unknown[] = []): PhotoDoc {
  const r = parsePhotoDoc({
    ...newPhotoDoc(256, 256),
    layers: [
      { id: 'e', type: 'exposure', params: { ev, offset: 0, gamma: 1 } },
      { id: 'd', type: 'dehaze', params: { amount: 32 } },
      ...extra,
    ],
  });
  if (!r.ok) throw new Error(r.error);
  return r.doc;
}

/**
 * Upper bound on live surfaces + images (+ pictures): split (2) + the detail cache cap (6 off-GPU;
 * 2 on the phone) + the shown render's and the next render's own intermediates (dehaze: dark
 * channel + grid, 2 each).
 */
const BOUND = 2 + 6 + 4;
/**
 * Live shaders: only the shown render's chain (a fixed number per document shape, here ≤ 16), never
 * the superseded renders'. Paints and image filters: none outside a call.
 */
const SHADER_BOUND = 16;

const textures = (c: Counts) => c.surfaces + c.images + c.pictures;
const ZERO: Counts = { surfaces: 0, images: 0, pictures: 0, shaders: 0, paints: 0, imageFilters: 0 };

/** The fixture source is made on the uncounted API; its images' shaders are counted all the same. */
function source(c: ReturnType<typeof countingApi>) {
  const src = fixtureSource(base, 'photo');
  c.watch(src.image);
  c.watch(src.split!.color);
  c.watch(src.split!.alpha);
  return src;
}

describe('GPU object lifetimes (Skia 3)', () => {
  it('render: every texture-pinning wrapper stays bounded over a slider drag, zero after dispose', async () => {
    const c = countingApi(base);
    const pipe = new PhotoPipeline(c.api);
    const src = source(c);
    const live: Counts[] = [];
    let shown: { release: () => void } | null = null;
    for (let i = 0; i < 30; i += 1) {
      const r = await pipe.render(src, doc(i / 10));
      expect(r.width).toBeGreaterThan(0);
      // As the canvas does: the superseded result is released once the new one is shown.
      shown?.release();
      shown = r;
      live.push(c.live());
    }
    expect(Math.max(...live.map(textures))).toBeLessThanOrEqual(BOUND);
    expect(Math.max(...live.map((x) => x.shaders))).toBeLessThanOrEqual(SHADER_BOUND);
    expect(Math.max(...live.map((x) => x.paints + x.imageFilters))).toBe(0);
    // No upward trend: the last renders hold no more than the early ones.
    expect(c.total()).toBeLessThanOrEqual(
      live[9]!.surfaces + live[9]!.images + live[9]!.pictures + live[9]!.shaders,
    );
    pipe.dispose();
    expect(c.live()).toEqual(ZERO);
  });

  it('readPixels: the readback surface and snapshot are released after each readback', async () => {
    const c = countingApi(base);
    const pipe = new PhotoPipeline(c.api);
    const src = source(c);
    const live: Counts[] = [];
    for (let i = 0; i < 20; i += 1) {
      const r = await pipe.readPixels(src, doc(i / 10), { width: 32, height: 32 });
      expect(r!.pixels.length).toBe(32 * 32 * 4);
      live.push(c.live());
    }
    expect(Math.max(...live.map(textures))).toBeLessThanOrEqual(BOUND);
    // A readback releases its render at once: no shader, paint or filter survives it.
    expect(Math.max(...live.map((x) => x.shaders + x.paints + x.imageFilters))).toBe(0);
    expect(textures(live[19]!)).toBeLessThanOrEqual(textures(live[9]!));
    pipe.dispose();
    expect(c.live()).toEqual(ZERO);
  });

  it('a second detail layer (clarity) and a mask stay bounded too', async () => {
    const c = countingApi(base);
    const pipe = new PhotoPipeline(c.api, undefined, { feather: 'skia' });
    const src = source(c);
    const clarity = { id: 'c', type: 'clarity', params: { amount: 40 } };
    const masked = {
      id: 'm',
      type: 'exposure',
      params: { ev: 0.5, offset: 0, gamma: 1 },
      mask: {
        components: [{ kind: 'radial', mode: 'add', center: { x: 0.5, y: 0.5 }, rx: 0.3, ry: 0.3 }],
        feather: 20,
      },
    };
    const live: Counts[] = [];
    let shown: { release: () => void } | null = null;
    for (let i = 0; i < 20; i += 1) {
      const r = await pipe.render(src, doc(i / 10, [clarity, masked]));
      shown?.release();
      shown = r;
      live.push(c.live());
    }
    expect(pipe.maskComputes).toBeGreaterThan(0);
    expect(Math.max(...live.map(textures))).toBeLessThanOrEqual(BOUND + 4 + 1);
    expect(Math.max(...live.map((x) => x.shaders))).toBeLessThanOrEqual(SHADER_BOUND + 8);
    expect(Math.max(...live.map((x) => x.paints + x.imageFilters))).toBe(0);
    expect(c.total()).toBeLessThanOrEqual(
      textures(live[9]!) + live[9]!.shaders,
    );
    pipe.dispose();
    expect(c.live()).toEqual(ZERO);
  });

  it('recordDocPicture / renderDocPixels leave only the picture behind', async () => {
    const c = countingApi(base);
    const src = source(c);
    const layers = doc(0.5).layers.filter((l) => l.type === 'exposure');
    for (let i = 0; i < 5; i += 1) {
      const pic = recordDocPicture(c.api, src.image, layers);
      expect(c.live()).toEqual({ ...ZERO, pictures: 1 });
      pic.dispose();
      expect(await renderDocPixels(c.api, src.image, layers, 16, 16)).not.toBeNull();
      expect(c.live()).toEqual(ZERO);
    }
  });
});
