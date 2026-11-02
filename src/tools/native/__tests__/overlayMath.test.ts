import {
  MIN_HIT,
  clampRect,
  containRect,
  displayToNorm,
  hitArea,
  moveRect,
  normToDisplay,
  rectAt,
  rectFromPoints,
  resizeFromCorner,
} from '../overlayMath';

describe('containRect', () => {
  it('letterboxes a landscape image in a square canvas (bars top and bottom)', () => {
    expect(containRect({ width: 300, height: 300 }, 2)).toEqual({
      left: 0,
      top: 75,
      width: 300,
      height: 150,
    });
  });
  it('pillarboxes a portrait image in a square canvas (bars left and right)', () => {
    expect(containRect({ width: 300, height: 300 }, 0.5)).toEqual({
      left: 75,
      top: 0,
      width: 150,
      height: 300,
    });
  });
  it('fills exactly when the aspects match, and survives a zero layout', () => {
    expect(containRect({ width: 200, height: 100 }, 2)).toEqual({
      left: 0,
      top: 0,
      width: 200,
      height: 100,
    });
    expect(containRect({ width: 0, height: 0 }, 1).width).toBe(0);
  });
});

describe('norm <-> display with letterboxing in both orientations', () => {
  const cases = [
    ['landscape', 1.5],
    ['portrait', 0.75],
  ] as const;
  it.each(cases)('%s round trip', (_n, aspect) => {
    const layout = { width: 360, height: 400 };
    const box = { x: 0.2, y: 0.3, width: 0.4, height: 0.25 };
    const d = normToDisplay(box, layout, aspect);
    const a = displayToNorm({ x: d.left, y: d.top }, layout, aspect);
    const b = displayToNorm({ x: d.left + d.width, y: d.top + d.height }, layout, aspect);
    expect(a.x).toBeCloseTo(0.2, 6);
    expect(a.y).toBeCloseTo(0.3, 6);
    expect(b.x).toBeCloseTo(0.6, 6);
    expect(b.y).toBeCloseTo(0.55, 6);
  });
  it('a face at the image origin sits inside the bar offset, not at the canvas origin', () => {
    const d = normToDisplay(
      { x: 0, y: 0, width: 0.1, height: 0.1 },
      { width: 300, height: 300 },
      2,
    );
    expect(d.top).toBe(75);
    expect(d.left).toBe(0);
  });
  it('points in the bars clamp onto the image edge', () => {
    expect(displayToNorm({ x: -50, y: 0 }, { width: 300, height: 300 }, 2)).toEqual({ x: 0, y: 0 });
    expect(displayToNorm({ x: 400, y: 400 }, { width: 300, height: 300 }, 2)).toEqual({
      x: 1,
      y: 1,
    });
  });
});

describe('clamp, min size, move, resize', () => {
  it('clamps into [0,1] and enforces the minimum side', () => {
    expect(clampRect({ x: -0.2, y: 0.95, width: 0.5, height: 0.5 })).toEqual({
      x: 0,
      y: 0.5,
      width: 0.5,
      height: 0.5,
    });
    const tiny = clampRect({ x: 0.5, y: 0.5, width: 0, height: 0.001 });
    expect(tiny.width).toBe(0.01);
    expect(tiny.height).toBe(0.01);
  });
  it('rectFromPoints works in any drag direction', () => {
    const r = rectFromPoints({ x: 0.6, y: 0.7 }, { x: 0.2, y: 0.1 });
    expect(r).toMatchObject({ x: 0.2, y: 0.1 });
    expect(r.width).toBeCloseTo(0.4, 9);
    expect(r.height).toBeCloseTo(0.6, 9);
  });
  it('move keeps the size and stops at the edges', () => {
    const r = moveRect({ x: 0.5, y: 0.5, width: 0.4, height: 0.4 }, 0.5, -1);
    expect(r).toEqual({ x: 0.6, y: 0, width: 0.4, height: 0.4 });
  });
  it('resizing a corner keeps the opposite corner and flips when dragged over it', () => {
    const r = resizeFromCorner({ x: 0.2, y: 0.2, width: 0.2, height: 0.2 }, 'se', 0.1, 0.1);
    expect(r).toMatchObject({ x: 0.2, y: 0.2 });
    expect(r.width).toBeCloseTo(0.3, 9);
    const flipped = resizeFromCorner({ x: 0.2, y: 0.2, width: 0.2, height: 0.2 }, 'se', -0.3, 0);
    expect(flipped.x).toBeCloseTo(0.1, 9);
    expect(flipped.width).toBeCloseTo(0.1, 9);
    const edge = resizeFromCorner({ x: 0.2, y: 0.2, width: 0.2, height: 0.2 }, 'nw', -1, -1);
    expect(edge).toMatchObject({ x: 0, y: 0 });
  });
});

describe('hit areas and picking', () => {
  it('grows a tiny face to 44 pt around its centre', () => {
    const h = hitArea({ left: 100, top: 100, width: 10, height: 20 });
    expect(h.width).toBe(MIN_HIT);
    expect(h.height).toBe(MIN_HIT);
    expect(h.left + h.width / 2).toBe(105);
    expect(h.top + h.height / 2).toBe(110);
  });
  it('leaves a big box alone', () => {
    const d = { left: 1, top: 2, width: 100, height: 80 };
    expect(hitArea(d)).toEqual(d);
  });
  it('rectAt returns the topmost containing rect', () => {
    const rs = [
      { x: 0, y: 0, width: 1, height: 1 },
      { x: 0.2, y: 0.2, width: 0.2, height: 0.2 },
    ];
    expect(rectAt(rs, { x: 0.3, y: 0.3 })).toBe(1);
    expect(rectAt(rs, { x: 0.9, y: 0.9 })).toBe(0);
    expect(rectAt([], { x: 0, y: 0 })).toBe(-1);
  });
});
