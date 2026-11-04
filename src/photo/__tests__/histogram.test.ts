import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { computeHistogram64, HISTOGRAM_BINS, histogramSize, normaliseBins } from '../histogram';

const chart = () => PNG.sync.read(readFileSync(`${__dirname}/../fixtures/images/chart.png`));

describe('histogram (64 bins, from the 256 px readback)', () => {
  it('on the chart fixture: every pixel counted once per channel, sums match', () => {
    const png = chart();
    const h = computeHistogram64(png.data);
    expect(h.r).toHaveLength(HISTOGRAM_BINS);
    const total = png.width * png.height;
    let opaque = 0;
    for (let i = 3; i < png.data.length; i += 4) if (png.data[i] !== 0) opaque += 1;
    expect(h.count).toBe(opaque);
    for (const ch of [h.r, h.g, h.b, h.luma]) expect(ch.reduce((s, v) => s + v, 0)).toBe(opaque);
    expect(opaque).toBeLessThanOrEqual(total);
    expect(h.max).toBe(Math.max(...[h.r, h.g, h.b, h.luma].flatMap((c) => Array.from(c))));
  });

  it('on the chart fixture: the bins equal a direct 4-level bucketing of the bytes', () => {
    const png = chart();
    const h = computeHistogram64(png.data);
    const r = new Array(64).fill(0);
    for (let i = 0; i < png.data.length; i += 4)
      if (png.data[i + 3] !== 0) r[Math.floor(png.data[i]! / 4)] += 1;
    expect(Array.from(h.r)).toEqual(r);
  });

  it('skips transparent pixels and bins luma like the web (BT.709, rounded)', () => {
    const h = computeHistogram64([255, 0, 0, 255, 0, 255, 0, 255, 9, 9, 9, 0]);
    expect(h.r[63]).toBe(1);
    expect(h.g[63]).toBe(1);
    expect(h.r[2]).toBe(0);
    expect(h.count).toBe(2);
    expect(h.luma[Math.round(0.2126 * 255) >> 2]).toBe(1);
    expect(h.luma[Math.round(0.7152 * 255) >> 2]).toBe(1);
  });

  it('reads back at 256 px on the long side, never upscaling', () => {
    expect(histogramSize(4000, 3000)).toEqual({ width: 256, height: 192, scale: 0.064 });
    expect(histogramSize(100, 50)).toEqual({ width: 100, height: 50, scale: 1 });
    expect(histogramSize(3000, 4000).height).toBe(256);
  });

  it('normalises with a sqrt scale', () => {
    expect(normaliseBins(Uint32Array.from([0, 25, 100]), 100)).toEqual([0, 0.5, 1]);
    expect(normaliseBins(Uint32Array.from([0, 0]), 0)).toEqual([0, 0]);
  });
});
