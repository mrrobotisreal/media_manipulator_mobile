import { clampRange, shiftRange, snap, timeToX, xToTime } from '../rangeMath';
import { containFit, displaySize, initialRect, moveRect, resizeRect } from '../frameCropMath';
import { thumbCount, thumbTimes } from '../useVideoThumbnails';

describe('rangeMath', () => {
  it('round-trips x <-> t', () => {
    for (const t of [0, 1.5, 33.3, 60]) {
      expect(xToTime(timeToX(t, 60, 300), 60, 300)).toBeCloseTo(t, 6);
    }
    expect(timeToX(5, 0, 300)).toBe(0);
    expect(xToTime(999, 60, 300)).toBe(60);
    expect(timeToX(-4, 60, 300)).toBe(0);
  });
  it('clamps at both ends', () => {
    expect(clampRange(-5, 10, 60)).toEqual({ start: 0, end: 10 });
    expect(clampRange(5, 99, 60)).toEqual({ start: 5, end: 60 });
  });
  it('keeps the min gap, giving way on the dragged side', () => {
    const a = clampRange(9.99, 10, 60, 0.1, 'start');
    expect(a.end - a.start).toBeCloseTo(0.1, 9);
    expect(a.end).toBe(10);
    const b = clampRange(10, 10.01, 60, 0.1, 'end');
    expect(b.start).toBe(10);
    expect(b.end - b.start).toBeCloseTo(0.1, 9);
    const c = clampRange(60, 60, 60, 0.1, 'start');
    expect(c.end).toBe(60);
    expect(c.end - c.start).toBeCloseTo(0.1, 9);
    const d = clampRange(0, 0, 60, 0.1, 'end');
    expect(d).toEqual({ start: 0, end: 0.1 });
  });
  it('snaps to tenths', () => {
    expect(snap(1.234)).toBe(1.2);
    expect(snap(1.26)).toBe(1.3);
    expect(snap(2.5, 1)).toBe(3);
  });
  it('shifts a window inside the bounds', () => {
    expect(shiftRange(2, 6, -10, 60)).toEqual({ start: 0, end: 4 });
    expect(shiftRange(2, 6, 100, 60)).toEqual({ start: 56, end: 60 });
  });
});

describe('thumbnail planning', () => {
  it('clamps the count to 6..12', () => {
    expect(thumbCount(100)).toBe(6);
    expect(thumbCount(480)).toBe(10);
    expect(thumbCount(2000)).toBe(12);
    expect(thumbCount(NaN)).toBe(6);
  });
  it('takes slice mid-points', () => {
    expect(thumbTimes(60, 6)).toEqual([5, 15, 25, 35, 45, 55]);
    expect(thumbTimes(0, 6)).toEqual([]);
  });
});

describe('frameCropMath', () => {
  it('swaps a track size that disagrees with the oriented thumbnail', () => {
    expect(displaySize({ width: 1920, height: 1080 }, { width: 108, height: 160 })).toEqual({
      width: 1080,
      height: 1920,
    });
    expect(displaySize({ width: 1080, height: 1920 }, { width: 108, height: 160 })).toEqual({
      width: 1080,
      height: 1920,
    });
    expect(displaySize({ width: 1920, height: 1080 })).toEqual({ width: 1920, height: 1080 });
  });
  it('builds a centred initial square', () => {
    const r = initialRect(1080, 1920, 1);
    expect(r.width).toBeCloseTo(r.height, 6);
    expect(r.x + r.width / 2).toBeCloseTo(540, 6);
  });
  it('moves inside bounds and resizes from the opposite anchor', () => {
    const r = { x: 100, y: 100, width: 200, height: 200 };
    expect(moveRect(r, -500, 5000, 1000, 1000)).toEqual({ x: 0, y: 800, width: 200, height: 200 });
    const br = resizeRect(r, 'br', 50, 50, 1000, 1000, null);
    expect(br).toEqual({ x: 100, y: 100, width: 250, height: 250 });
    const tl = resizeRect(r, 'tl', -500, -500, 1000, 1000, null);
    expect(tl).toEqual({ x: 0, y: 0, width: 300, height: 300 });
    const locked = resizeRect(r, 'br', 100, 0, 1000, 1000, 1);
    expect(locked.width).toBeCloseTo(locked.height, 6);
  });
  it('letterboxes', () => {
    expect(containFit(1000, 500, 200, 200)).toEqual({ scale: 0.2, ox: 0, oy: 50 });
  });
});
