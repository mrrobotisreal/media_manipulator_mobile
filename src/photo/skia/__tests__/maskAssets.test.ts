/**
 * @jest-environment node
 *
 * Brush PNGs (coverage in alpha) and subject masks (opaque grey, white = subject) decode to the
 * grey rasters the mask passes read; a fresh bake installs its alpha without a decode.
 */
import { PNG } from 'pngjs';
import { MaskAssetStore } from '../maskAssets';
import { loadSkiaApi } from '../testing/skiaTestApi';
import type { SkiaApi } from '../shaderChain';

jest.setTimeout(60_000);

const png = (
  w: number,
  h: number,
  f: (x: number, y: number) => [number, number, number, number],
) => {
  const p = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) * 4;
      const [r, g, b, a] = f(x, y);
      p.data[o] = r;
      p.data[o + 1] = g;
      p.data[o + 2] = b;
      p.data[o + 3] = a;
    }
  return PNG.sync.write(p);
};

describe('MaskAssetStore', () => {
  let api: SkiaApi;
  beforeAll(async () => {
    api = await loadSkiaApi();
  });

  it('brush: alpha channel; subject: red of an opaque grey PNG; both cached and announced', async () => {
    const brush = `data:image/png;base64,${png(4, 2, (x) => [255, 255, 255, x * 80]).toString('base64')}`;
    const subject = png(4, 2, (x) => [x * 60, x * 60, x * 60, 255]);
    const seen: string[] = [];
    const store = new MaskAssetStore(api, {
      subjectBytes: async (ref) => {
        seen.push(ref);
        return new Uint8Array(subject);
      },
    });
    let events = 0;
    store.subscribe(() => (events += 1));
    const doc = {
      layers: [
        {
          id: 'a',
          type: 'exposure',
          enabled: true,
          opacity: 1,
          blend: 'normal',
          params: { ev: 0, offset: 0, gamma: 1 },
          mask: {
            components: [
              { kind: 'brush', mode: 'add', png: brush, width: 4, height: 2 },
              { kind: 'subject', mode: 'add', maskRef: 'masks/s1.png', invert: false },
            ],
            feather: 0,
            invert: false,
            opacity: 1,
          },
        },
      ],
    } as never;
    await store.ensure(doc);
    await store.ensure(doc);
    expect(seen).toEqual(['masks/s1.png']);
    expect(events).toBe(2);
    expect(Array.from(store.alphaOf(brush)!.alpha).slice(0, 4)).toEqual([0, 80, 160, 240]);
    expect(Array.from(store.alphaOf('masks/s1.png')!.alpha).slice(0, 4)).toEqual([0, 60, 120, 180]);
  });

  it('putAlpha installs a baked brush without decoding', () => {
    const store = new MaskAssetStore(api, { subjectBytes: async () => null });
    store.putAlpha('data:image/png;base64,AAAA', {
      width: 2,
      height: 1,
      alpha: new Uint8Array([7, 200]),
    });
    expect(store.has('data:image/png;base64,AAAA')).toBe(true);
    expect(Array.from(store.alphaOf('data:image/png;base64,AAAA')!.alpha)).toEqual([7, 200]);
  });
});
