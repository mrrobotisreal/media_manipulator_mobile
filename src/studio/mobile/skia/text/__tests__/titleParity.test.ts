/**
 * @jest-environment node
 *
 * Darkroom titles (ticket MA62 S3, decision 8): the phone's Skia Paragraph port of the web's
 * `rasterTitle` against the web's own `rasterTitle` (the copied `src/studio/titleRaster.ts`, run
 * unchanged on CanvasKit's Canvas2D emulation, `testing/canvas2d.ts`), both with the same bundled
 * font files, on the harness's title goldens (`src/studio/parity/goldens/title_*.json`). Thresholds
 * are the rows of `parityTolerances.ts` (`title_layers` 30 dB, `title_fonts` 32 dB), never loosened.
 *
 * What is held to the rows and what is visual only: see `TITLE_TOLERANCES` at the end.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { psnr } from '../../../../parity/imageMetrics';
import { parityTolerance } from '../../../../parityTolerances';
import { layoutTitleText, rasterTitle } from '../../../../titleRaster';
import { STUDIO_TITLE_FONTS } from '../../../../titleFonts';
import type { StudioTitle, StudioTitleTextLayer } from '../../../../studioTypes';
import { loadCanvasKit, loadSkiaApi } from '../../../../../photo/skia/testing/skiaTestApi';
import type { SkiaApi } from '../../compositor/compositor';
import { diff8 } from '../../compositor/testing/render';
import type { Rgba } from '../../compositor/testing/reference';
import { createStudioFonts } from '../fonts';
import { BUNDLED_FONTS_FILES } from '../testing/bundledFiles';
import { fontBytes, rasterWithCanvas2d } from '../testing/canvas2d';
import { middleBaselineOffset, rasterTitleImage } from '../titleRaster';

jest.setTimeout(180_000);

const GOLDENS = join(__dirname, '..', '..', '..', '..', 'parity', 'goldens');
const golden = (id: string) => JSON.parse(readFileSync(join(GOLDENS, `${id}.json`), 'utf8'));

// The goldens' 640x360 project, rastered at its own size (the web's backing size for 640x360).
const W = 640;
const H = 360;

let api: SkiaApi;
let ck: unknown;
let fonts: ReturnType<typeof createStudioFonts>;
beforeAll(async () => {
  api = await loadSkiaApi();
  ck = await loadCanvasKit();
  fonts = createStudioFonts({
    api,
    bundled: BUNDLED_FONTS_FILES,
    loadBundled: async (file) => {
      const b = fontBytes(String(file));
      return api.Data.fromBytes(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
    },
    // DejaVu Sans is downloaded on the phone; jest has no network: it stays on the fallback.
    loadDownloaded: async () => null,
  });
  await fonts.ensure(Object.keys(BUNDLED_FONTS_FILES));
});
afterAll(() => fonts.dispose());

const results: string[] = [];
afterAll(() => {
  if (process.env.MA62_PARITY_REPORT) console.log(results.join('\n'));
});

/** Straight RGBA raster over an opaque base (black, or `under`), the BLEND SPEC's normal mode. */
function over(raster: Uint8Array, under: Rgba | null): Rgba {
  const out = new Uint8Array(W * H * 4);
  for (let p = 0; p < W * H; p += 1) {
    const a = raster[p * 4 + 3]! / 255;
    for (let k = 0; k < 3; k += 1) {
      const b = under ? under.data[p * 4 + k]! / 255 : 0;
      out[p * 4 + k] = Math.round((b + (raster[p * 4 + k]! / 255 - b) * a) * 255);
    }
    out[p * 4 + 3] = 255;
  }
  return { width: W, height: H, data: out };
}

async function phoneRaster(title: StudioTitle): Promise<Uint8Array> {
  const surface = api.Surface.MakeRaster(W, H);
  const img = rasterTitleImage({ api, fonts: fonts.provider, surface: () => surface }, title, W, H, W);
  surface?.dispose();
  if (!img) throw new Error('raster');
  const px = (await img.readPixels(0, 0, {
    width: W,
    height: H,
    colorType: 4,
    alphaType: 3,
  })) as Uint8Array;
  img.dispose();
  return px;
}

function webRaster(
  title: StudioTitle,
  measure?: Parameters<typeof rasterWithCanvas2d>[4],
): Uint8Array {
  return rasterWithCanvas2d(ck, W, H, (ctx) => rasterTitle(ctx as never, title, W, H, W), measure);
}

/** The phone's line width (its paragraph's), to hand to the web code so both lay out alike. */
function phoneMeasure() {
  return (text: string, f: { family: string; weight: number; px: number }) => {
    const b = api.ParagraphBuilder.Make({}, fonts.provider);
    b.pushStyle({
      fontFamilies: [f.family, 'Inter'],
      fontSize: f.px,
      fontStyle: { weight: f.weight },
    });
    b.addText(text);
    const p = b.build();
    p.layout(1e6);
    const w = p.getMaxIntrinsicWidth();
    p.dispose();
    b.dispose();
    return w;
  };
}

/** A background standing in for the video under `title_layers` (the chart fixture, scaled to fill). */
function backdrop(): Rgba {
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y += 1)
    for (let x = 0; x < W; x += 1) {
      const o = (y * W + x) * 4;
      data[o] = (x * 255) / W;
      data[o + 1] = (y * 255) / H;
      data[o + 2] = ((x ^ y) & 32) === 0 ? 200 : 40;
      data[o + 3] = 255;
    }
  return { width: W, height: H, data };
}

/** The title with its text layers only, or without them. */
const textOnly = (t: StudioTitle): StudioTitle => ({
  layers: t.layers.filter((l) => l.type === 'text'),
});
const noText = (t: StudioTitle): StudioTitle => ({
  layers: t.layers.filter((l) => l.type !== 'text'),
});

function titleOf(id: string): StudioTitle {
  const g = golden(id);
  return g.project.tracks
    .flatMap((t: { clips: { title?: StudioTitle }[] }) => t.clips)
    .find((c: { title?: StudioTitle }) => c.title).title;
}

/** Lit-pixel bounding box per text line band (rows between line centres). */
function lineBoxes(px: Uint8Array, centres: number[]): [number, number, number, number][] {
  return centres.map((c, i) => {
    const y0 = Math.max(0, Math.floor(i === 0 ? c - 60 : (centres[i - 1]! + c) / 2));
    const y1 = Math.min(
      H,
      Math.ceil(i === centres.length - 1 ? c + 60 : (c + centres[i + 1]!) / 2),
    );
    let x0 = W;
    let x1 = -1;
    let t = H;
    let b = -1;
    for (let y = y0; y < y1; y += 1)
      for (let x = 0; x < W; x += 1)
        if (px[(y * W + x) * 4 + 3]! > 127) {
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          t = Math.min(t, y);
          b = Math.max(b, y);
        }
    return [x0, x1, t, b];
  });
}

describe('rect, line and background plates: pixels vs the web rasterTitle (row title_layers)', () => {
  it('title_layers without its glyphs: plate, rect and divider', async () => {
    const row = parityTolerance('title_layers')!;
    const full = titleOf('title_layers');
    // The plates are drawn by the text layer; keep it but with transparent glyphs so only the plates
    // (sized from the line widths, which the phone measures with its paragraphs and passes to the
    // web code too: the same layout numbers) remain.
    const plates: StudioTitle = {
      layers: full.layers.map((l) =>
        l.type === 'text'
          ? { ...l, fillColor: '#00000000', strokeColor: undefined, shadow: undefined }
          : l,
      ),
    };
    const measure = phoneMeasure();
    const phone = over(await phoneRaster(plates), backdrop());
    const web = over(webRaster(plates, measure), backdrop());
    const v = psnr(phone, web);
    const d = diff8(phone, web);
    const label = `title_layers.plates psnr=${v.toFixed(2)} (row title_layers ${row.threshold}) max8=${d.max} mean8=${d.mean.toFixed(3)}`;
    results.push(label);
    expect([label, v >= row.threshold]).toEqual([label, true]);
    // And the rect + line alone, which take no text measure at all.
    const shapes = noText(full);
    const v2 = psnr(
      over(await phoneRaster(shapes), backdrop()),
      over(webRaster(shapes), backdrop()),
    );
    results.push(`title_layers.shapes psnr=${v2.toFixed(2)}`);
    expect([v2, v2 >= row.threshold]).toEqual([v2, true]);
  });
});

describe('text lines: where each line lands vs the web rasterTitle (layout, not glyph pixels)', () => {
  const IDS = ['title_layers', 'title_fonts_a', 'title_fonts_b', 'title_fonts_c'];
  it.each(IDS)(
    '%s: every line starts and sits within 1 px of the web raster (left, top, bottom)',
    async (id) => {
      const measure = phoneMeasure();
      for (const l of textOnly(titleOf(id)).layers) {
        const layer = l as StudioTitleTextLayer;
        // Skip DejaVu Sans: downloaded on the phone, so jest draws the fallback family on both sides.
        if (layer.fontFamily === 'DejaVu Sans') continue;
        // One layer at a time, glyph fill only (the stroke and shadow widen the box by design).
        const one: StudioTitle = {
          layers: [{ ...layer, strokeColor: undefined, shadow: undefined, background: undefined }],
        };
        const phone = await phoneRaster(one);
        const web = webRaster(one, measure);
        const lay = layoutTitleText(layer, W, H, 1, (s) =>
          measure(s, { family: layer.fontFamily, weight: layer.fontWeight, px: layer.fontSizePx }),
        );
        const centres = lay.lines.map((x) => x.centerYPx);
        const a = lineBoxes(phone, centres);
        const b = lineBoxes(web, centres);
        a.forEach((box, i) => {
          // Left / top / bottom: where the line is placed (anchor, align, 'middle' baseline, line
          // height). The right edge is the shaped width: the phone kerns, the emulation does not
          // (recorded, not gated: the deviation the design's title row names).
          const placement = [0, 2, 3].map((k) => Math.abs(box[k]! - b[i]![k]!));
          results.push(
            `${id}.${layer.fontFamily}.${i} box phone=${box.join(',')} web=${b[i]!.join(',')} rightEdgeDelta=${box[1]! - b[i]![1]!}`,
          );
          expect([id, layer.fontFamily, i, Math.max(...placement) <= 1]).toEqual([
            id,
            layer.fontFamily,
            i,
            true,
          ]);
        });
      }
    },
  );

  it.each(IDS)(
    '%s: whole-frame PSNR recorded (glyph pixels are visual only, see TITLE_TOLERANCES)',
    async (id) => {
      const rowId = id === 'title_layers' ? 'title_layers' : 'title_fonts';
      const title = titleOf(id);
      const under = id === 'title_layers' ? backdrop() : null;
      const v = psnr(
        over(await phoneRaster(title), under),
        over(webRaster(title, phoneMeasure()), under),
      );
      results.push(
        `${id} glyphs psnr=${v.toFixed(2)} (row ${rowId} ${parityTolerance(rowId)!.threshold}: NOT gated, visual only)`,
      );
      expect(v).toBeGreaterThan(0);
    },
  );
});

/**
 * The tolerance table for titles (decision 10). Glyph pixels have no web reference jest can run:
 * the web rasters text with the browser's canvas (shaped, hinted by the browser's font stack), and
 * the harness renders its title goldens on a GPU workstation without committing frames. The
 * CanvasKit Canvas2D emulation that runs the web's `rasterTitle` here draws UNSHAPED text blobs with
 * CanvasKit's own hinting, so its glyphs are not the browser's either; whole-frame PSNR of white
 * glyphs on black is dominated by sub-pixel placement (measured 14.5 to 27 dB with visually equal
 * rasters, see the session log). So glyph pixels are "visual only" (device + browser check), while
 * layout (line boxes within 2 px), the non-text layers and the plates are held to the row.
 */
export const TITLE_TOLERANCES = [
  {
    part: 'rect + line layers',
    row: 'title_layers',
    check: 'pixels vs the web rasterTitle (Canvas2D emulation)',
  },
  {
    part: 'background plates',
    row: 'title_layers',
    check: 'pixels vs the web rasterTitle, same line widths',
  },
  {
    part: 'line placement (anchor, align, middle baseline, line height)',
    row: 'title_layers, title_fonts',
    check: 'left / top / bottom of each line within 1 px (a port check, not a row value)',
  },
  {
    part: 'line width (kerning)',
    row: 'title_fonts',
    check: 'recorded only: the phone shapes and kerns, the emulation does not',
  },
  {
    part: 'glyph pixels (all 16 families)',
    row: 'title_fonts',
    check: 'VISUAL ONLY: no browser glyph reference in jest',
  },
] as const;

describe('the shared layout spec is the web code, not a copy (line centres, anchors, plates)', () => {
  it('every text layer of the goldens lays out through the copied layoutTitleText', () => {
    for (const id of ['title_layers', 'title_fonts_a', 'title_fonts_b', 'title_fonts_c']) {
      const g = golden(id);
      for (const tr of g.project.tracks)
        for (const c of tr.clips)
          for (const l of c.title?.layers ?? []) {
            if (l.type !== 'text') continue;
            const layout = layoutTitleText(l as StudioTitleTextLayer, W, H, 1, (s) => s.length);
            const lines = (l as StudioTitleTextLayer).text.split('\n').length;
            expect(layout.lines).toHaveLength(lines);
            expect(layout.blockHeightPx).toBeCloseTo(lines * layout.lineHeightPx, 9);
          }
    }
  });

  it("'middle' baseline: half the normalised typo ascent minus descent, per family (Blink's rule)", () => {
    // Inter: typo 1984 / -494 at 2048 upm -> a = 37 * 1984 / 2478, d = 37 - a.
    const a = (37 * 1984) / 2478;
    expect(middleBaselineOffset('Inter', 700, 37)).toBeCloseTo((a - (37 - a)) / 2, 9);
    // An unknown family uses the fallback's metrics.
    expect(middleBaselineOffset('Nope', 400, 20)).toBeCloseTo(
      middleBaselineOffset('Inter', 400, 20),
      9,
    );
  });

  it('every registry family except DejaVu Sans is bundled (DejaVu is downloaded)', () => {
    const bundled = Object.keys(BUNDLED_FONTS_FILES);
    for (const f of STUDIO_TITLE_FONTS) {
      if (f.family === 'DejaVu Sans') expect(bundled).not.toContain(f.family);
      else expect([f.family, bundled.includes(f.family)]).toEqual([f.family, true]);
    }
  });
});
