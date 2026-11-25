/**
 * @jest-environment node
 *
 * MA62 decision 0 (MA60's rule): every shader, paint and image the compositor makes has an owner
 * that disposes it, and a clip's chain is built once, not per frame. Counted on CanvasKit through
 * the Aperture counting proxy (`src/photo/skia/testing/countingApi.ts`: surfaces, images, pictures,
 * shaders, paints, image filters). jest runs on CPU, so this pins ownership, not GPU memory: the
 * phone check is `dumpsys meminfo` Graphics (MA62 device check).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCubeLut } from '../../../../../photo/studioLutParser';
import { countingApi } from '../../../../../photo/skia/testing/countingApi';
import { loadSkiaApi } from '../../../../../photo/skia/testing/skiaTestApi';
import { Compositor, RETIRE_FRAMES, type FrameLayer, type SkiaApi } from '../compositor';
import type { CompLayer } from '../uniforms';

jest.setTimeout(120_000);

const W = 64;
const H = 36;
const LUT = parseCubeLut(readFileSync(join(__dirname, '..', '..', '..', '..', 'parity', 'fixture.cube'), 'utf8'));

let base: SkiaApi;
beforeAll(async () => {
  base = await loadSkiaApi();
});

function sourceImage(api: SkiaApi, w = 32, h = 18) {
  const bytes = new Uint8Array(w * h * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 37) % 256));
  const img = api.Image.MakeRaster({ width: w, height: h, colorType: 4, alphaType: 3 }, api.Data.fromBytes(bytes), w * 4);
  if (!img) throw new Error('image');
  return img;
}

/** A heavy two-clip scene: every stage, a keyframed (changing) layer, addition blend, a dip. */
function scene(t: number, a: unknown, b: unknown): FrameLayer[] {
  const top: CompLayer = {
    slot: 1,
    srcW: 32,
    srcH: 18,
    opacity: 0.8,
    blendMode: 'addition',
    transform: { x: 0.1 * Math.sin(t), y: 0, scale: 0.9, rotationDeg: 10 * t },
    crop: { left: 0.1, top: 0, right: 0, bottom: 0.1 },
    eq: { brightness: 0.05, contrast: 1.1, saturation: 1.2 },
    lumetri: { exposure: 0.2 * t, contrast: 1, saturation: 1, temperature: 10, tint: 0, vibrance: 0.2 },
    lut: { key: 'lut', intensity: 0.6 },
    chroma: { keyColor: [0, 1, 0], similarity: 0.2, blend: 0.1, despill: 0.4 },
    wipe: { left: 0, top: 0, right: 0.5 - t / 100, bottom: 0 },
  };
  const bottom: CompLayer = { slot: 0, srcW: 32, srcH: 18, opacity: 1, blendMode: 'multiply' };
  const dip: CompLayer = { slot: -1, srcW: W, srcH: H, opacity: 0.4, solid: [1, 1, 1] };
  return [
    { key: 'bottom', layer: bottom, source: { kind: 'image', image: a as never } },
    { key: 'top', layer: top, source: { kind: 'image', image: b as never } },
    { key: 'top:dip', layer: dip, source: { kind: 'solid' } },
  ];
}

function drawFrames(api: SkiaApi, comp: Compositor, frames: number, at: (k: number) => FrameLayer[], perFrame?: () => void) {
  const surface = api.Surface.MakeRaster(W, H)!;
  for (let k = 0; k < frames; k += 1) {
    comp.draw(surface.getCanvas(), at(k), W, H);
    surface.flush();
    comp.endFrame();
    perFrame?.();
  }
  surface.dispose();
}

describe('compositor GPU object lifetimes (counting proxy)', () => {
  it('a playing keyframed scene: live shaders and paints stay bounded, 0 after dispose', () => {
    const c = countingApi(base);
    const a = sourceImage(c.api);
    const b = sourceImage(c.api);
    const comp = new Compositor(c.api);
    comp.loadLut('lut', LUT);
    let maxShaders = 0;
    let maxPaints = 0;
    drawFrames(c.api, comp, 120, (k) => scene(k / 30, a, b), () => {
      maxShaders = Math.max(maxShaders, c.live().shaders);
      maxPaints = Math.max(maxPaints, c.live().paints);
    });
    // Per frame the scene holds: bottom 3 (source, geometry, alpha), top 9 (source, 6 stages, LUT
    // atlas shader, opaque pass), dip 3. Changing stages retire their old shader for RETIRE_FRAMES
    // frames: top re-makes geometry..alpha (6) + opaque each frame -> <= 7 x RETIRE_FRAMES pending.
    expect(maxShaders).toBeLessThanOrEqual(15 + 7 * RETIRE_FRAMES);
    // Paints: one per chain (3) + addition's two + the black background.
    expect(maxPaints).toBeLessThanOrEqual(6);
    comp.dispose();
    a.dispose();
    b.dispose();
    expect(c.live()).toEqual({ surfaces: 0, images: 0, pictures: 0, shaders: 0, paints: 0, imageFilters: 0 });
  });

  it('a paused scene makes no shader per frame (chains built once, nothing rebuilt)', () => {
    const c = countingApi(base);
    const a = sourceImage(c.api);
    const b = sourceImage(c.api);
    const comp = new Compositor(c.api);
    comp.loadLut('lut', LUT);
    drawFrames(c.api, comp, 1, () => scene(1, a, b));
    const made = ['bottom', 'top', 'top:dip'].map((k) => comp.chainOf(k)!.made);
    const live = c.live().shaders;
    drawFrames(c.api, comp, 200, () => scene(1, a, b));
    expect(['bottom', 'top', 'top:dip'].map((k) => comp.chainOf(k)!.made)).toEqual(made);
    expect(c.live().shaders).toBe(live);
    comp.dispose();
    a.dispose();
    b.dispose();
    expect(c.total()).toBe(0);
  });

  it('a keyframed opacity remakes only the alpha stage', () => {
    const c = countingApi(base);
    const a = sourceImage(c.api);
    const comp = new Compositor(c.api);
    const layer = (k: number): FrameLayer[] => [
      {
        key: 'x',
        layer: { slot: 0, srcW: 32, srcH: 18, opacity: 0.5 + k / 1000, lumetri: { exposure: 0.3, contrast: 1, saturation: 1, temperature: 0, tint: 0, vibrance: 0 } },
        source: { kind: 'image', image: a },
      },
    ];
    drawFrames(c.api, comp, 1, () => layer(0));
    const before = comp.chainOf('x')!.made;
    drawFrames(c.api, comp, 50, (k) => layer(k + 1));
    expect(comp.chainOf('x')!.made - before).toBe(50);
    comp.dispose();
    a.dispose();
    expect(c.total()).toBe(0);
  });

  it('clips leaving the scene release their chain (after RETIRE_FRAMES), a resized source re-wraps once', () => {
    const c = countingApi(base);
    const a = sourceImage(c.api);
    const b = sourceImage(c.api);
    const comp = new Compositor(c.api);
    comp.loadLut('lut', LUT);
    drawFrames(c.api, comp, 5, () => scene(0, a, b));
    const full = c.live();
    drawFrames(c.api, comp, RETIRE_FRAMES + 1, () => [scene(0, a, b)[0]!]);
    const one = c.live();
    expect(one.shaders).toBeLessThan(full.shaders);
    expect(one.paints).toBeLessThan(full.paints);
    expect(comp.chainOf('top')).toBeUndefined();
    // The slot's texture image is replaced (a resize): one new source shader, the old one retired.
    const a2 = sourceImage(c.api, 48, 27);
    const before = comp.chainOf('bottom')!.made;
    drawFrames(c.api, comp, RETIRE_FRAMES + 1, () => [{ ...scene(0, a2, b)[0]!, layer: { ...scene(0, a2, b)[0]!.layer, srcW: 48, srcH: 27 } }]);
    expect(comp.chainOf('bottom')!.made - before).toBe(3); // source + geometry (new size) + alpha above it
    expect(c.live().shaders).toBe(one.shaders);
    comp.dispose();
    [a, a2, b].forEach((x) => x.dispose());
    expect(c.total()).toBe(0);
  });

  it('LUT atlas images are owned by the compositor', () => {
    const c = countingApi(base);
    const comp = new Compositor(c.api);
    comp.loadLut('one', LUT);
    comp.loadLut('one', LUT);
    comp.loadLut('two', LUT);
    expect(c.live().images).toBe(2);
    comp.dispose();
    expect(c.total()).toBe(0);
  });
});
