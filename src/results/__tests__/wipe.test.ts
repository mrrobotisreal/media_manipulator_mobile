import { clampWipe, formatDelta, stepWipe, wipeFromPointer, wipeToLeft } from '../compare/wipe';

describe('clampWipe', () => {
  it('clamps and maps NaN to 50', () => {
    expect(clampWipe(-5)).toBe(0);
    expect(clampWipe(105)).toBe(100);
    expect(clampWipe(33)).toBe(33);
    expect(clampWipe(Number.NaN)).toBe(50);
    expect(clampWipe(Infinity)).toBe(100);
    expect(clampWipe(-Infinity)).toBe(0);
  });
});

describe('stepWipe', () => {
  it('moves by 10 and stays in bounds', () => {
    expect(stepWipe(50, 'increment')).toBe(60);
    expect(stepWipe(50, 'decrement')).toBe(40);
    expect(stepWipe(100, 'increment')).toBe(100);
    expect(stepWipe(0, 'decrement')).toBe(0);
    expect(stepWipe(Number.NaN, 'increment')).toBe(60);
  });
});

describe('wipeFromPointer (logical coordinates)', () => {
  it('LTR: 0 % is the left edge', () => {
    expect(wipeFromPointer(0, 200, false)).toBe(0);
    expect(wipeFromPointer(100, 200, false)).toBe(50);
    expect(wipeFromPointer(200, 200, false)).toBe(100);
    expect(wipeFromPointer(900, 200, false)).toBe(100);
    expect(wipeFromPointer(-50, 200, false)).toBe(0);
  });
  it('RTL: 0 % is the right edge (the handle starts from the right)', () => {
    expect(wipeFromPointer(200, 200, true)).toBe(0);
    expect(wipeFromPointer(150, 200, true)).toBe(25);
    expect(wipeFromPointer(0, 200, true)).toBe(100);
  });
  it('handles zero-width views and non-finite input', () => {
    expect(wipeFromPointer(10, 0, false)).toBe(50);
    expect(wipeFromPointer(Infinity, 200, true)).toBe(50);
    expect(wipeFromPointer(Number.NaN, 200, false)).toBe(50);
  });
  it('round-trips through wipeToLeft in both directions', () => {
    for (const rtl of [false, true]) {
      for (const pct of [0, 20, 50, 80, 100]) {
        expect(wipeFromPointer(wipeToLeft(pct, 300, rtl), 300, rtl)).toBeCloseTo(pct, 6);
      }
    }
  });
});

describe('formatDelta', () => {
  it('formats signed percent change', () => {
    expect(formatDelta(1000, 380)).toBe('−62%');
    expect(formatDelta(1000, 1120)).toBe('+12%');
    expect(formatDelta(1000, 1000)).toBe('0%');
  });
  it('is null without a usable baseline', () => {
    expect(formatDelta(0, 10)).toBeNull();
    expect(formatDelta(undefined, 10)).toBeNull();
    expect(formatDelta(10, Number.NaN)).toBeNull();
  });
});
