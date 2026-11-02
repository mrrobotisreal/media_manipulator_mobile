import { clampRange, snap, timeToX, xToTime } from '../rangeMath';

describe('rangeMath', () => {
  it('time <-> x round trips and clamps', () => {
    expect(timeToX(15, 60, 300)).toBe(75);
    expect(xToTime(75, 60, 300)).toBe(15);
    expect(xToTime(timeToX(42.5, 60, 300), 60, 300)).toBeCloseTo(42.5);
    expect(timeToX(-5, 60, 300)).toBe(0);
    expect(timeToX(90, 60, 300)).toBe(300);
    expect(xToTime(999, 60, 300)).toBe(60);
    expect(timeToX(5, 0, 300)).toBe(0);
    expect(xToTime(5, 60, 0)).toBe(0);
  });
  it('snap rounds to the step', () => {
    expect(snap(1.26)).toBeCloseTo(1.3);
    expect(snap(1.26, 0.5)).toBe(1.5);
  });
  it('clampRange stays inside [0, duration]', () => {
    expect(clampRange(-4, 99, 60)).toEqual({ start: 0, end: 60 });
  });
  it('clampRange enforces the min gap against the handle that did not move', () => {
    expect(clampRange(29.99, 30, 60, 0.1, 'start')).toEqual({ start: 29.9, end: 30 });
    expect(clampRange(30, 30.02, 60, 0.1, 'end')).toEqual({ start: 30, end: 30.1 });
  });
  it('clampRange survives an end at the duration and a tiny clip', () => {
    expect(clampRange(59.99, 60, 60, 0.1, 'end')).toEqual({ start: 59.9, end: 60 });
    expect(clampRange(0, 0.05, 0.05)).toEqual({ start: 0, end: 0.05 });
  });
});
