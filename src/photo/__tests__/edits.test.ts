import { newPhotoDoc, type PhotoDoc } from '../photoTypes';
import {
  addCurvePoint,
  curvePoints,
  dragCurvePoint,
  greyExceptRange,
  hslRanges,
  paramOf,
  reorderFromList,
  setLevels,
  setNested,
  setParam,
  setRange,
} from '../edits';

const blank = () => newPhotoDoc(400, 300);

describe('sheet edits', () => {
  it('a Basic slider creates its layer once and edits it in place', () => {
    let d = setParam(blank(), 'exposure', 'ev', 1);
    d = setParam(d, 'exposure', 'ev', 1.5);
    expect(d.layers).toHaveLength(1);
    expect(paramOf(d, 'exposure', 'ev', 0)).toBe(1.5);
    expect(setParam(d, 'exposure', 'ev', 1.5)).toBe(d); // no-op keeps the reference
  });

  it('"Grey except this" on Reds writes saturation -100 to the other five ranges', () => {
    const d = greyExceptRange(blank(), 'reds');
    const sat = Object.fromEntries(hslRanges(d).map((r) => [r.id, r.saturation]));
    expect(sat).toEqual({
      reds: 0,
      yellows: -100,
      greens: -100,
      cyans: -100,
      blues: -100,
      magentas: -100,
    });
  });

  it('per-range sliders edit only that range', () => {
    const d = setRange(blank(), 'blues', 'hue', 30);
    expect(hslRanges(d).map((r) => r.hue)).toEqual([0, 0, 0, 0, 30, 0]);
  });

  it('nested params (colour balance) and levels keep black below white', () => {
    let d = setNested(blank(), 'colorBalance', ['shadows', 'r'], 20);
    expect((d.layers[0]!.params as { shadows: { r: number } }).shadows.r).toBe(20);
    d = setLevels(d, 'master', 'inWhite', 0.5);
    d = setLevels(d, 'master', 'inBlack', 0.9);
    const lv = d.layers.find((l) => l.type === 'levels')!.params as {
      master: { inBlack: number; inWhite: number };
    };
    expect(lv.master.inBlack).toBeLessThan(lv.master.inWhite);
  });

  it('curves: adding a point keeps x sorted; a drag past a neighbour is refused (clamped)', () => {
    let d: PhotoDoc = blank();
    const a = addCurvePoint(d, 'master', 0.25, 0.2);
    d = a.doc;
    const b = addCurvePoint(d, 'master', 0.75, 0.85);
    d = b.doc;
    expect(curvePoints(d, 'master').map((p) => p.x)).toEqual([0, 0.25, 0.75, 1]);
    const r = dragCurvePoint(d, 'master', 1, 0.9, 0.5);
    expect(r.refused).toBe(true);
    const xs = curvePoints(r.doc, 'master').map((p) => p.x);
    expect(xs.every((x, i) => i === 0 || x > xs[i - 1]!)).toBe(true);
    expect(xs[1]).toBeLessThan(0.75);
  });

  it('reorders from the list order (top of the stack first)', () => {
    let d = setParam(blank(), 'exposure', 'ev', 1);
    d = setParam(d, 'tone', 'shadows', 10);
    d = setParam(d, 'gamma', 'gamma', 1.2);
    // list: gamma, tone, exposure; drag exposure to the top
    d = reorderFromList(d, 'exposure', 0);
    expect(d.layers.map((l) => l.type)).toEqual(['tone', 'gamma', 'exposure']);
  });
});
