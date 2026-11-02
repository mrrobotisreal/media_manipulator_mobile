import {
  applyAspect,
  centredRect,
  clampRect,
  containBox,
  displayToSource,
  moveRect,
  resizeCorner,
  sourceToDisplay,
} from '../cropMath';

const SRC = { width: 4000, height: 3000 };

describe('cropMath', () => {
  it('containBox letterboxes and reports the scale', () => {
    const b = containBox({ width: 400, height: 400 }, SRC);
    expect(b.scale).toBeCloseTo(0.1);
    expect(b).toMatchObject({ x: 0, width: 400, height: 300 });
    expect(b.y).toBeCloseTo(50);
  });

  it('display <-> source round-trips within 1 px', () => {
    for (const scale of [0.1, 0.0733, 0.333, 1]) {
      const src = { x: 123, y: 456, width: 1500, height: 777 };
      const back = displayToSource(sourceToDisplay(src, scale), scale, SRC);
      expect(Math.abs(back.x - src.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.y - src.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.width - src.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.height - src.height)).toBeLessThanOrEqual(1);
    }
  });

  it('displayToSource returns integers inside the source', () => {
    const r = displayToSource({ x: 399.7, y: 299.7, width: 50, height: 50 }, 0.1, SRC);
    expect(Number.isInteger(r.x) && Number.isInteger(r.width)).toBe(true);
    expect(r.x + r.width).toBeLessThanOrEqual(SRC.width);
    expect(r.y + r.height).toBeLessThanOrEqual(SRC.height);
    expect(r.width).toBeGreaterThanOrEqual(1);
  });

  it('clampRect holds at every edge and enforces the minimum', () => {
    const b = { width: 100, height: 80 };
    expect(clampRect({ x: -20, y: 5, width: 30, height: 30 }, b, 10).x).toBe(0);
    expect(clampRect({ x: 90, y: 5, width: 30, height: 30 }, b, 10).x).toBe(70);
    expect(clampRect({ x: 5, y: -9, width: 30, height: 30 }, b, 10).y).toBe(0);
    expect(clampRect({ x: 5, y: 70, width: 30, height: 30 }, b, 10).y).toBe(50);
    const tiny = clampRect({ x: 5, y: 5, width: 2, height: 3 }, b, 10);
    expect(tiny.width).toBe(10);
    expect(tiny.height).toBe(10);
    const huge = clampRect({ x: 0, y: 0, width: 500, height: 500 }, b, 10);
    expect(huge).toEqual({ x: 0, y: 0, width: 100, height: 80 });
  });

  it('moveRect stops at the bounds', () => {
    const b = { width: 100, height: 100 };
    const r = { x: 10, y: 10, width: 40, height: 40 };
    expect(moveRect(r, -50, -50, b)).toMatchObject({ x: 0, y: 0 });
    expect(moveRect(r, 500, 500, b)).toMatchObject({ x: 60, y: 60 });
    expect(moveRect(r, 5, 6, b)).toMatchObject({ x: 15, y: 16 });
  });

  it('applyAspect yields the ratio, inside bounds, about the centre', () => {
    const b = { width: 400, height: 300 };
    for (const a of [1, 4 / 3, 3 / 4, 16 / 9, 9 / 16]) {
      const r = applyAspect({ x: 20, y: 20, width: 360, height: 260 }, a, b, 16);
      expect(r.width / r.height).toBeCloseTo(a, 5);
      expect(r.x).toBeGreaterThanOrEqual(-1e-9);
      expect(r.y).toBeGreaterThanOrEqual(-1e-9);
      expect(r.x + r.width).toBeLessThanOrEqual(400 + 1e-9);
      expect(r.y + r.height).toBeLessThanOrEqual(300 + 1e-9);
    }
    const free = applyAspect({ x: 1, y: 1, width: 50, height: 20 }, null, b, 16);
    expect(free).toEqual({ x: 1, y: 1, width: 50, height: 20 });
  });

  it('centredRect is 80 % centred and respects aspect', () => {
    const r = centredRect(SRC, null);
    expect(r.x).toBeCloseTo(400);
    expect(r.y).toBeCloseTo(300);
    expect(r.width).toBeCloseTo(3200);
    expect(r.height).toBeCloseTo(2400);
    const sq = centredRect(SRC, 1);
    expect(sq.width).toBeCloseTo(sq.height);
    expect(sq.x + sq.width / 2).toBeCloseTo(2000);
    expect(sq.y + sq.height / 2).toBeCloseTo(1500);
  });

  it('resizeCorner keeps the opposite corner fixed and clamps', () => {
    const b = { width: 200, height: 200 };
    const start = { x: 50, y: 50, width: 100, height: 100 };
    const br = resizeCorner(start, 'br', 30, 20, b, 10, null);
    expect(br).toEqual({ x: 50, y: 50, width: 130, height: 120 });
    const tl = resizeCorner(start, 'tl', -20, -10, b, 10, null);
    expect(tl).toEqual({ x: 30, y: 40, width: 120, height: 110 });
    expect(resizeCorner(start, 'br', 999, 999, b, 10, null)).toEqual({
      x: 50,
      y: 50,
      width: 150,
      height: 150,
    });
    expect(resizeCorner(start, 'tl', 999, 999, b, 10, null)).toMatchObject({
      width: 10,
      height: 10,
    });
    expect(resizeCorner(start, 'tr', 0, 0, b, 10, null)).toEqual(start);
    expect(resizeCorner(start, 'bl', -999, 0, b, 10, null).x).toBe(0);
  });

  it('resizeCorner honours a locked aspect', () => {
    const b = { width: 400, height: 300 };
    const start = { x: 100, y: 100, width: 160, height: 90 };
    const r = resizeCorner(start, 'br', 80, 10, b, 10, 16 / 9);
    expect(r.width / r.height).toBeCloseTo(16 / 9, 5);
    expect(r.x).toBe(100);
    expect(r.y).toBe(100);
    const wall = resizeCorner(start, 'br', 900, 900, b, 10, 16 / 9);
    expect(wall.x + wall.width).toBeLessThanOrEqual(400 + 1e-9);
    expect(wall.y + wall.height).toBeLessThanOrEqual(300 + 1e-9);
    expect(wall.width / wall.height).toBeCloseTo(16 / 9, 5);
  });
});
