/**
 * @jest-environment node
 *
 * MA60: on react-native-skia 3 `readPixels`, `encodeToBytes` and `encodeToBase64` return promises
 * (CanvasKit's JSI API too, which these tests run on). A readback site that forgot `await` used to
 * compile and silently take its fallback (`instanceof Uint8Array` is false for a Promise). One test
 * per site: each asserts the REAL value (never the fallback), and `pixelBytes` turns a Promise that
 * reaches pixel code into an error, so dropping an `await` fails here instead of on the phone.
 */
import { PNG } from 'pngjs';
import { dehazeLight } from '../../colorMath';
import { computeHistogram64 } from '../../histogram';
import { newPhotoDoc, parsePhotoDoc } from '../../photoTypes';
import { skiaPngEncoder } from '../../tools/brush';
import { renderHealMaskPng } from '../healMask';
import { hasTransparency, MaskAssetStore } from '../maskAssets';
import { DEHAZE_LIGHT_FALLBACK, gridDehazeLight, PhotoPipeline } from '../pipeline';
import { pixelBytes } from '../readback';
import { renderDocPixels } from '../render';
import type { SkiaApi } from '../shaderChain';
import { fixtureSource, rgbaImage } from '../testing/fixtureSource';
import { loadSkiaApi } from '../testing/skiaTestApi';

jest.setTimeout(120_000);

const pngBytes = (
  w: number,
  h: number,
  f: (x: number, y: number) => [number, number, number, number],
) => {
  const p = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) * 4;
      p.data.set(f(x, y), o);
    }
  return new Uint8Array(PNG.sync.write(p));
};

let api: SkiaApi;
beforeAll(async () => {
  api = await loadSkiaApi();
});

describe('pixelBytes (the guard every readback site goes through)', () => {
  it('throws when a Promise reaches it, passes bytes, and maps anything else to null', async () => {
    const pending = Promise.resolve(new Uint8Array(4));
    expect(() => pixelBytes(pending)).toThrow(/not awaited/);
    expect(() => pixelBytes({ then: () => undefined })).toThrow(/not awaited/);
    const bytes = new Uint8Array([1, 2, 3, 4]);
    expect(pixelBytes(bytes)).toBe(bytes);
    expect(pixelBytes(null)).toBeNull();
    expect(pixelBytes(new Float32Array(4))).toBeNull();
    await pending;
  });

  it('CanvasKit v3 readback really is a Promise (why the sites must await)', async () => {
    const img = rgbaImage(api, 1, 1, new Uint8Array([10, 20, 30, 255]), true);
    const r = img.readPixels(0, 0, { width: 1, height: 1, colorType: 4, alphaType: 3 });
    expect(typeof (r as unknown as Promise<unknown>).then).toBe('function');
    expect(Array.from(pixelBytes(await r)!)).toEqual([10, 20, 30, 255]);
    const enc = img.encodeToBytes();
    expect(typeof (enc as unknown as Promise<unknown>).then).toBe('function');
    await enc;
  });
});

describe('every readback / encode site resolves real pixels, never its fallback', () => {
  it('render.ts renderDocPixels (the histogram readback) returns the bytes', async () => {
    const parsed = parsePhotoDoc({ ...newPhotoDoc(4, 2), layers: [{ id: 'i', type: 'invert' }] });
    if (!parsed.ok) throw new Error(parsed.error);
    const img = rgbaImage(api, 4, 2, new Uint8Array(4 * 2 * 4).fill(255));
    const px = await renderDocPixels(api, img, parsed.doc.layers, 4, 2);
    expect(px).toBeInstanceOf(Uint8Array);
    expect(Array.from(px!.slice(0, 4))).toEqual([0, 0, 0, 255]);
    expect(computeHistogram64(px!).count).toBe(8);
  });

  it('pipeline.ts readPixels (histogram, preset thumbnails, eyedropper) returns the bytes', async () => {
    const parsed = parsePhotoDoc({
      ...newPhotoDoc(256, 256),
      layers: [{ id: 'i', type: 'invert' }],
    });
    if (!parsed.ok) throw new Error(parsed.error);
    const r = await new PhotoPipeline(api).readPixels(fixtureSource(api, 'chart'), parsed.doc, {
      width: 16,
      height: 16,
    });
    expect(r).not.toBeNull();
    expect(r!.pixels).toBeInstanceOf(Uint8Array);
    expect(r!.pixels.length).toBe(16 * 16 * 4);
    expect(computeHistogram64(r!.pixels).count).toBeGreaterThan(0);
  });

  it('pipeline.ts auto-dehaze light reads the dark-channel grid (not the 0.05 fallback)', async () => {
    // A 4x4 dark-channel grid with known values in .r.
    const vals = [10, 40, 80, 120, 160, 200, 220, 230, 240, 250, 30, 60, 90, 110, 130, 150];
    const rgba = new Uint8Array(16 * 4);
    vals.forEach((v, i) => rgba.set([v, v, v, 255], i * 4));
    const grid = rgbaImage(api, 4, 4, rgba, true);
    const want = dehazeLight(Float64Array.from(vals, (v) => v / 255));
    expect(want).not.toBe(DEHAZE_LIGHT_FALLBACK);
    await expect(gridDehazeLight(grid, 4, 4)).resolves.toBeCloseTo(want, 10);
  });

  it('maskAssets.ts hasTransparency reads alpha (subject PNG alpha rule)', async () => {
    const decode = (b: Uint8Array) => api.Image.MakeFromEncoded(api.Data.fromBytes(b))!;
    const opaque = decode(pngBytes(2, 1, () => [90, 90, 90, 255]));
    const holey = decode(pngBytes(2, 1, (x) => [255, 255, 255, x === 0 ? 0 : 255]));
    await expect(hasTransparency(opaque)).resolves.toBe(false);
    await expect(hasTransparency(holey)).resolves.toBe(true);
  });

  it('maskAssets.ts: a subject PNG with alpha is read by alpha, and alphaOf has it once loaded', async () => {
    // White everywhere, coverage in alpha: the red rule would read 255 (or 0) everywhere, the alpha
    // rule reads the ramp. A silently-false `hasTransparency` would pick the red rule.
    const subject = pngBytes(4, 1, (x) => [255, 255, 255, x * 60]);
    const store = new MaskAssetStore(api, { subjectBytes: async () => subject });
    expect(store.alphaOf('masks/a.png')).toBeNull();
    await store.ensure({
      layers: [
        {
          id: 'a',
          type: 'exposure',
          enabled: true,
          opacity: 1,
          blend: 'normal',
          params: { ev: 0, offset: 0, gamma: 1 },
          mask: {
            components: [{ kind: 'subject', mode: 'add', maskRef: 'masks/a.png', invert: false }],
            feather: 0,
            invert: false,
            opacity: 1,
          },
        },
      ],
    } as never);
    expect(Array.from(store.alphaOf('masks/a.png')!.alpha)).toEqual([0, 60, 120, 180]);
  });

  it('healMask.ts encodes a real PNG (encodeToBytes awaited)', async () => {
    const bytes = await renderHealMaskPng(api, [{ pts: [{ x: 2, y: 2 }], diameter: 3 }], {
      width: 5,
      height: 5,
    });
    expect(bytes).toBeInstanceOf(Uint8Array);
    const png = PNG.sync.read(Buffer.from(bytes));
    expect([png.width, png.height, png.data[(2 * 5 + 2) * 4]]).toEqual([5, 5, 255]);
  });

  it('brush.ts skiaPngEncoder returns a data URI of the real PNG (encodeToBase64 awaited)', async () => {
    const encode = skiaPngEncoder(api as never);
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 128]);
    const uri = await encode(rgba, 2, 1);
    expect(uri).not.toContain('[object Promise]');
    const m = /^data:image\/png;base64,(.+)$/.exec(uri);
    expect(m).not.toBeNull();
    const png = PNG.sync.read(Buffer.from(m![1]!, 'base64'));
    expect([png.width, png.height, png.data[0], png.data[7]]).toEqual([2, 1, 255, 128]);
  });

  it('brush.ts skiaPngEncoder rejects when the encode does not resolve to a string', async () => {
    const fake = {
      Image: { MakeRaster: () => ({ encodeToBase64: async () => undefined }) },
      Data: { fromBytes: (b: Uint8Array) => b },
    };
    await expect(skiaPngEncoder(fake as never)(new Uint8ClampedArray(4), 1, 1)).rejects.toThrow(
      'brush encode',
    );
  });
});
