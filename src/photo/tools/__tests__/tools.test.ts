/**
 * MA51 touch-tool maths (acceptance 3): screen → geometry-space normalisation for the gradient and
 * radial drags, the colour-range target from a (mocked) `readPixels`, red-eye, and the brush bake
 * (<= 1024 px, <= 512 KB, the web's raster engine).
 */
import { PNG } from 'pngjs';
import { brushAlpha } from '../../goldens';
import { maskOfLayer, dataUriBytes } from '../../maskOps';
import {
  newPhotoDoc,
  parsePhotoDoc,
  PHOTO_MAX_BRUSH_PNG_BYTES,
  type PhotoDoc,
} from '../../photoTypes';
import { beginBrush, bakeInto, brushIndexOf, paintStroke } from '../brush';
import {
  gradientComponent,
  handleAngle,
  normToScreen,
  pickColorTarget,
  pixelAt,
  radialComponent,
  redEyeAt,
  screenToNorm,
  type ViewState,
} from '../canvasMath';

const pngEncoder = async (rgba: Uint8ClampedArray, width: number, height: number) => {
  const png = new PNG({ width, height });
  png.data = Buffer.from(rgba);
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
};

function docWithLayer(w = 4000, h = 3000): PhotoDoc {
  const r = parsePhotoDoc({
    ...newPhotoDoc(w, h),
    layers: [{ id: 'L', type: 'exposure', params: { ev: 1 } }],
  });
  if (!r.ok) throw new Error(r.error);
  return r.doc;
}

// A 4000x3000 image fitted into a 400x400 canvas (scale 0.1, letterboxed 50 pt top and bottom).
const view: ViewState = {
  canvasW: 400,
  canvasH: 400,
  imageW: 4000,
  imageH: 3000,
  scale: 0.1,
  tx: 0,
  ty: 0,
};

describe('screen -> geometry space', () => {
  it('maps the image corners and centre, and round-trips', () => {
    expect(screenToNorm(view, { x: 0, y: 50 })).toEqual({ x: 0, y: 0 });
    expect(screenToNorm(view, { x: 400, y: 350 })).toEqual({ x: 1, y: 1 });
    expect(screenToNorm(view, { x: 200, y: 200 })).toEqual({ x: 0.5, y: 0.5 });
    const n = { x: 0.3, y: 0.7 };
    const back = screenToNorm(view, normToScreen(view, n));
    expect(back.x).toBeCloseTo(0.3, 10);
    expect(back.y).toBeCloseTo(0.7, 10);
  });

  it('follows pan and zoom', () => {
    const zoomed = { ...view, scale: 0.2, tx: 100, ty: -40 };
    const p = normToScreen(zoomed, { x: 0.25, y: 0.5 });
    expect(p).toEqual({ x: 400 / 2 + 100 - 400 + 0.25 * 800, y: 200 - 40 });
  });
});

describe('gradient and radial components', () => {
  it('a drag becomes a normalized gradient (from -> to); a tap is ignored', () => {
    const a = screenToNorm(view, { x: 200, y: 50 });
    const b = screenToNorm(view, { x: 200, y: 350 });
    const c = gradientComponent(a, b)!;
    expect(c).toMatchObject({
      kind: 'gradient',
      mode: 'add',
      from: { x: 0.5, y: 0 },
      to: { x: 0.5, y: 1 },
    });
    expect(gradientComponent(a, a)).toBeNull();
  });

  it('a radial drag gives per-axis normalized radii, and the rotate handle angle', () => {
    const c = radialComponent({ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.7 })!;
    expect(c).toMatchObject({
      kind: 'radial',
      center: { x: 0.5, y: 0.5 },
      rx: 0.1,
      ry: 0.2,
      rotate: 0,
    });
    expect(radialComponent({ x: 0.5, y: 0.5 }, { x: 0.501, y: 0.501 })).toBeNull();
    expect(handleAngle({ x: 0, y: 0 }, { x: 1, y: 1 })).toBe(45);
    expect(handleAngle({ x: 0, y: 0 }, { x: 0, y: -1 })).toBe(-90);
  });
});

describe('colour range from readPixels (mocked)', () => {
  // 2x2 RGBA readback: red, green / blue, white.
  const px = new Uint8Array([
    200, 30, 30, 255, 30, 200, 30, 255, 30, 30, 200, 255, 255, 255, 255, 255,
  ]);

  it('reads the pixel under the finger', () => {
    expect(pixelAt(px, 2, 2, { x: 0.1, y: 0.1 })).toEqual({ r: 200, g: 30, b: 30 });
    expect(pixelAt(px, 2, 2, { x: 0.9, y: 0.9 })).toEqual({ r: 255, g: 255, b: 255 });
    expect(pixelAt(px, 2, 2, { x: 1.2, y: 0.5 })).toBeNull();
  });

  it('a tap starts a colour range; long press adds targets up to 8; a tap replaces', () => {
    let d = pickColorTarget(docWithLayer(), 'L', 0, { r: 200, g: 30, b: 30 }, false);
    let comp = maskOfLayer(d, 'L')!.components[0]!;
    expect(comp).toMatchObject({ kind: 'colorRange', colors: [{ r: 200, g: 30, b: 30 }] });
    for (let i = 0; i < 10; i += 1) d = pickColorTarget(d, 'L', 0, { r: i, g: i, b: i }, true);
    comp = maskOfLayer(d, 'L')!.components[0]!;
    expect(comp.kind === 'colorRange' && comp.colors.length).toBe(8);
    d = pickColorTarget(d, 'L', 0, { r: 1, g: 2, b: 3 }, false);
    comp = maskOfLayer(d, 'L')!.components[0]!;
    expect(comp.kind === 'colorRange' && comp.colors).toEqual([{ r: 1, g: 2, b: 3 }]);
  });
});

describe('red-eye', () => {
  it('a tap adds a redEye layer with a radial mask sized from the long side', () => {
    const r = redEyeAt(docWithLayer(), { x: 0.25, y: 0.5 }, 2, 4000, 3000)!;
    const layer = r.doc.layers.find((l) => l.id === r.layerId)!;
    expect(layer.type).toBe('redEye');
    const c = maskOfLayer(r.doc, r.layerId)!.components[0]!;
    expect(c).toMatchObject({ kind: 'radial', center: { x: 0.25, y: 0.5 }, rx: 0.02 });
    expect(c.kind === 'radial' && c.ry).toBeCloseTo(0.02 * (4000 / 3000), 10);
    expect(redEyeAt(docWithLayer(), { x: 1.5, y: 0.5 }, 2, 4000, 3000)).toBeNull();
  });
});

describe('brush bake (the web engine, phone encoder injected)', () => {
  it('paints in geometry space at <= 1024 px and installs a PNG <= 512 KB', async () => {
    const doc = docWithLayer();
    const s = beginBrush(4000, 3000, null);
    expect([s.raster.width, s.raster.height]).toEqual([1024, 768]);
    paintStroke(
      s,
      [
        { x: 0.1, y: 0.5 },
        { x: 0.9, y: 0.5 },
      ],
      { size: 400, hardness: 20, flow: 100, erase: false },
    );
    const r = await bakeInto(doc, 'L', s, pngEncoder);
    if (!r.ok) throw new Error(r.reason);
    expect(r.width).toBeLessThanOrEqual(1024);
    expect(dataUriBytes(r.png)).toBeLessThanOrEqual(PHOTO_MAX_BRUSH_PNG_BYTES);
    const comp = maskOfLayer(r.doc, 'L')!.components[0]!;
    expect(comp).toMatchObject({ kind: 'brush', width: r.width, height: r.height });
    // Coverage on the stroke, none far from it; the doc still parses (server shape).
    const a = brushAlpha(r.png)!;
    expect(a.alpha[384 * 1024 + 512]).toBe(255);
    expect(a.alpha[10 * 1024 + 512]).toBe(0);
    expect(parsePhotoDoc(JSON.parse(JSON.stringify(r.doc))).ok).toBe(true);
  });

  it('size is in source pixels (scaled to the raster) and erase removes coverage', async () => {
    const s = beginBrush(4000, 3000, null);
    paintStroke(s, [{ x: 0.5, y: 0.5 }], { size: 400, hardness: 100, flow: 100, erase: false });
    // 400 source px = 102.4 raster px across.
    const row = 384 * 1024;
    expect(s.raster.alpha[row + 512 + 45]).toBeGreaterThan(0.9);
    expect(s.raster.alpha[row + 512 + 60]).toBe(0);
    paintStroke(s, [{ x: 0.5, y: 0.5 }], { size: 400, hardness: 100, flow: 100, erase: true });
    expect(s.raster.alpha[row + 512]).toBeLessThan(0.01);
  });

  it('a noisy full-frame brush is halved under the 512 KB cap', async () => {
    const s = beginBrush(4000, 3000, null);
    let x = 2463534242;
    for (let i = 0; i < s.raster.alpha.length; i += 1) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      s.raster.alpha[i] = ((x >>> 0) & 255) / 255;
    }
    const r = await bakeInto(docWithLayer(), 'L', s, pngEncoder);
    if (!r.ok) throw new Error(r.reason);
    expect(dataUriBytes(r.png)).toBeLessThanOrEqual(PHOTO_MAX_BRUSH_PNG_BYTES);
    expect(r.width).toBeLessThan(1024);
  });

  it('continues the selected brush component instead of appending', async () => {
    const s = beginBrush(400, 300, null);
    paintStroke(s, [{ x: 0.5, y: 0.5 }], { size: 50, hardness: 50, flow: 100, erase: false });
    const first = await bakeInto(docWithLayer(400, 300), 'L', s, pngEncoder);
    if (!first.ok) throw new Error(first.reason);
    const idx = brushIndexOf(first.doc, 'L', 0);
    expect(idx).toBe(0);
    const s2 = beginBrush(400, 300, first.alpha, idx);
    paintStroke(s2, [{ x: 0.2, y: 0.2 }], { size: 50, hardness: 50, flow: 100, erase: false });
    const second = await bakeInto(first.doc, 'L', s2, pngEncoder);
    if (!second.ok) throw new Error(second.reason);
    expect(maskOfLayer(second.doc, 'L')!.components).toHaveLength(1);
  });
});
