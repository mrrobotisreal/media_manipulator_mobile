/**
 * @jest-environment node
 */
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { computeHistogram64 } from '../../histogram';
import { parsePhotoDoc } from '../../photoTypes';
import { recordDocPicture, renderDocPixels } from '../render';
import { loadSkiaApi } from '../testing/skiaTestApi';

jest.setTimeout(60_000);

describe('render helpers on real Skia', () => {
  it('reads back a downscaled adjusted image the histogram can use', async () => {
    const api = await loadSkiaApi();
    const png = PNG.sync.read(readFileSync(`${__dirname}/../../fixtures/images/chart.png`));
    const img = api.Image.MakeImage(
      { width: png.width, height: png.height, colorType: 4, alphaType: 3 },
      api.Data.fromBytes(new Uint8Array(png.data)),
      png.width * 4,
    )!;
    const doc = parsePhotoDoc({
      version: 1,
      source: { width: 256, height: 256 },
      layers: [{ id: 'i', type: 'invert' }],
    });
    if (!doc.ok) throw new Error(doc.error);
    const px = renderDocPixels(api, img, doc.doc.layers, 64, 64)!;
    expect(px).toHaveLength(64 * 64 * 4);
    const h = computeHistogram64(px);
    expect(h.count).toBeGreaterThan(0);
    const pic = recordDocPicture(api, img, doc.doc.layers);
    expect(pic).toBeTruthy();
  });
});
