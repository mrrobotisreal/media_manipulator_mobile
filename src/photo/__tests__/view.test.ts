import {
  actualScale,
  clampOffset,
  clampScale,
  doubleTapTarget,
  fitScale,
  imageRect,
  needsProxy,
  pinchTo,
  previewSize,
} from '../view';

const canvas = { width: 400, height: 800 };
const image = { width: 4000, height: 3000 };

describe('photo view math', () => {
  it('fits the long side and centres', () => {
    expect(fitScale(canvas, image)).toBe(0.1);
    expect(imageRect({ scale: 0.1, x: 0, y: 0 }, canvas, image)).toEqual({
      x: 0,
      y: 250,
      width: 400,
      height: 300,
    });
  });

  it('100 % means one ORIGINAL pixel per device pixel, also for a reduced preview', () => {
    expect(actualScale(3)).toBeCloseTo(1 / 3);
    expect(actualScale(3, 0.5)).toBeCloseTo(2 / 3);
  });

  it('double tap: fit -> 100 % around the finger, then back to fit', () => {
    const fit = { scale: 0.1, x: 0, y: 0 };
    const z = doubleTapTarget(fit, canvas, image, 1 / 3, { x: 200, y: 400 });
    expect(z.scale).toBeCloseTo(1 / 3);
    expect([z.x, z.y]).toEqual([0, 0]);
    expect(doubleTapTarget(z, canvas, image, 1 / 3, { x: 10, y: 10 })).toEqual({
      scale: 0.1,
      x: 0,
      y: 0,
    });
  });

  it('clamps zoom between fit/100 % and 4x 100 %, and pan inside the image', () => {
    expect(clampScale(0.01, 0.1, 1 / 3)).toBe(0.1);
    expect(clampScale(10, 0.1, 1 / 3)).toBeCloseTo(4 / 3);
    const t = clampOffset({ scale: 1, x: 99999, y: -99999 }, canvas, image);
    expect(t).toEqual({ scale: 1, x: (4000 - 400) / 2, y: -(3000 - 800) / 2 });
    expect(clampOffset({ scale: 0.1, x: 50, y: 50 }, canvas, image)).toEqual({
      scale: 0.1,
      x: 0,
      y: 0,
    });
  });

  it('pinch keeps the focal point fixed', () => {
    const start = { scale: 0.2, x: 0, y: 0 };
    const focal = { x: 300, y: 400 };
    const t = pinchTo(start, 2, focal, canvas, image, 0.1, 1 / 3);
    const before = (focal.x - canvas.width / 2 - start.x) / start.scale;
    const after = (focal.x - canvas.width / 2 - t.x) / t.scale;
    expect(after).toBeCloseTo(before);
  });

  it('previews from the proxy only above 24 MP; the texture is capped at 8 MP', () => {
    expect(needsProxy(4000, 3000)).toBe(false);
    expect(needsProxy(7728, 5152)).toBe(true);
    expect(needsProxy(undefined, 100)).toBe(false);
    expect(previewSize(3264, 2448)).toEqual({ width: 3264, height: 2448, scale: 1 });
    const p = previewSize(4000, 3000);
    expect(p.width * p.height).toBeLessThanOrEqual(8_000_000);
    expect(p.width / p.height).toBeCloseTo(4 / 3, 2);
  });
});
