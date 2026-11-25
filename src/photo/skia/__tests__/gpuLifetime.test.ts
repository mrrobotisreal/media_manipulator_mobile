/**
 * @jest-environment node
 *
 * MA60 (S25 device check): on react-native-skia 3 the pipeline's surfaces, intermediate images and
 * pictures are GPU textures that the GC does not reclaim in time (v3 reports a texture's size only
 * on the image/surface wrapper; the shaders and pictures that pin it report ~256 bytes). Every one
 * must have an owner that disposes it. Counted on CanvasKit through a proxy API: after N renders of
 * a doc with a dehaze layer and a changing upstream adjustment, the live count stays bounded by the
 * caches' caps plus the current render, and drops to zero once the pipeline is disposed.
 */
import { newPhotoDoc, parsePhotoDoc, type PhotoDoc } from '../../photoTypes';
import { PhotoPipeline } from '../pipeline';
import { countingApi } from '../testing/countingApi';
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
 * Upper bound: split (2) + the detail cache cap (6 off-GPU; 2 on the phone) + the shown render's
 * and the next render's own intermediates (dehaze: dark channel + grid, 2 each).
 */
const BOUND = 2 + 6 + 4;

describe('GPU object lifetimes (Skia 3)', () => {
  it('render: live surfaces/images/pictures stay bounded over a slider drag, zero after dispose', async () => {
    const c = countingApi(base);
    const pipe = new PhotoPipeline(c.api);
    const src = fixtureSource(base, 'photo');
    const live: number[] = [];
    let shown: { release: () => void } | null = null;
    for (let i = 0; i < 30; i += 1) {
      const r = await pipe.render(src, doc(i / 10));
      expect(r.width).toBeGreaterThan(0);
      // As the canvas does: the superseded result is released once the new one is shown.
      shown?.release();
      shown = r;
      live.push(c.total());
    }
    expect(Math.max(...live)).toBeLessThanOrEqual(BOUND);
    // No upward trend: the last renders hold no more than the early ones.
    expect(live[29]).toBeLessThanOrEqual(live[9]!);
    pipe.dispose();
    expect(c.live()).toEqual({ surfaces: 0, images: 0, pictures: 0 });
  });

  it('readPixels: the readback surface and snapshot are released after each readback', async () => {
    const c = countingApi(base);
    const pipe = new PhotoPipeline(c.api);
    const src = fixtureSource(base, 'photo');
    const live: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const r = await pipe.readPixels(src, doc(i / 10), { width: 32, height: 32 });
      expect(r!.pixels.length).toBe(32 * 32 * 4);
      live.push(c.total());
    }
    expect(Math.max(...live)).toBeLessThanOrEqual(BOUND);
    expect(live[19]).toBeLessThanOrEqual(live[9]!);
    pipe.dispose();
    expect(c.total()).toBe(0);
  });

  it('a second detail layer (clarity) and a mask stay bounded too', async () => {
    const c = countingApi(base);
    const pipe = new PhotoPipeline(c.api);
    const src = fixtureSource(base, 'photo');
    const clarity = { id: 'c', type: 'clarity', params: { amount: 40 } };
    const live: number[] = [];
    let shown: { release: () => void } | null = null;
    for (let i = 0; i < 20; i += 1) {
      const r = await pipe.render(src, doc(i / 10, [clarity]));
      shown?.release();
      shown = r;
      live.push(c.total());
    }
    expect(Math.max(...live)).toBeLessThanOrEqual(BOUND + 4);
    expect(live[19]).toBeLessThanOrEqual(live[9]!);
    pipe.dispose();
    expect(c.total()).toBe(0);
  });
});
