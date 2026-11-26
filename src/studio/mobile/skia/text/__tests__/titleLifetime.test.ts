/**
 * @jest-environment node
 *
 * MA62 decision 0 (MA60's rule) for titles: every paragraph, paint and surface the title raster
 * makes is disposed before it returns; the raster cache re-rasters only when the web's
 * `titleRasterKey` (or the fonts version) changes, never per frame; a replaced raster is retired
 * through the compositor and disposed `RETIRE_FRAMES` frames later; everything is 0 after dispose.
 * Counted on CanvasKit (`countingApi`: surfaces, images, pictures, shaders, paints, image filters,
 * plus paragraphs counted here). jest runs on CPU: the phone check is `dumpsys meminfo` Graphics.
 */
import type { SkParagraph } from 'react-native-skia';
import { countingApi } from '../../../../../photo/skia/testing/countingApi';
import { loadSkiaApi } from '../../../../../photo/skia/testing/skiaTestApi';
import type { StudioTitle, StudioTrack } from '../../../../studioTypes';
import { Compositor, RETIRE_FRAMES, type SkiaApi } from '../../compositor/compositor';
import { createStudioFonts } from '../fonts';
import { BUNDLED_FONTS_FILES } from '../testing/bundledFiles';
import { fontBytes } from '../testing/canvas2d';
import { TitleRasters } from '../titleRasters';

jest.setTimeout(120_000);

const title = (text: string): StudioTitle => ({
  layers: [
    { type: 'rect', x: 0.1, y: 0.6, w: 0.8, h: 0.3, color: '#101828', opacity: 0.8, radiusPx: 6 },
    {
      type: 'text',
      text,
      fontFamily: 'Montserrat',
      fontSizePx: 30,
      fontWeight: 700,
      fillColor: '#FFFFFF',
      strokeColor: '#000000',
      strokeWidthPx: 2,
      shadow: { xPx: 2, yPx: 2, blurPx: 4, color: '#000000' },
      background: { color: '#000000', opacity: 0.5, paddingXPx: 8, paddingYPx: 4, radiusPx: 4 },
      letterSpacingPx: 1,
      align: 'center',
      x: 0.5,
      y: 0.75,
    },
    { type: 'line', x1: 0.1, y1: 0.58, x2: 0.9, y2: 0.58, color: '#F97316', thicknessPx: 3 },
  ],
});
const tracks = (titles: Record<string, string>): StudioTrack[] => [
  {
    id: 'v1',
    kind: 'video',
    index: 1,
    muted: false,
    clips: Object.entries(titles).map(([id, text], i) => ({
      id,
      assetId: '',
      streamIndex: 0,
      timelineStart: i * 3,
      sourceIn: 0,
      sourceOut: 3,
      title: title(text),
    })),
  } as StudioTrack,
];

let base: SkiaApi;
beforeAll(async () => {
  base = await loadSkiaApi();
});

function setup() {
  const c = countingApi(base);
  const paragraphs = new Set<SkParagraph>();
  const fonts = createStudioFonts({
    api: c.api,
    bundled: BUNDLED_FONTS_FILES,
    loadBundled: async (file) => {
      const b = fontBytes(String(file));
      return c.api.Data.fromBytes(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
    },
    loadDownloaded: async () => null,
  });
  const comp = new Compositor(c.api);
  const rasters = new TitleRasters({
    api: c.api,
    fonts: fonts.provider,
    makeSurface: (w, h) => c.api.Surface.MakeRaster(w, h),
    retire: (o) => comp.retire(o),
    onParagraph: (p) => {
      paragraphs.add(p);
      const d = p.dispose.bind(p);
      p.dispose = () => {
        paragraphs.delete(p);
        d();
      };
    },
  });
  return { c, fonts, comp, rasters, paragraphs };
}

describe('title raster lifetimes (counting proxy)', () => {
  it('no paragraph, paint or surface outlives a raster; one image per title clip', async () => {
    const { c, fonts, comp, rasters, paragraphs } = setup();
    await fonts.ensure(['Montserrat']);
    rasters.sync(tracks({ t1: 'One\nTwo', t2: 'Three' }), 320, 180, 640, fonts.version);
    expect(rasters.rastered).toBe(2);
    expect(paragraphs.size).toBe(0);
    expect(c.live()).toEqual({
      surfaces: 0,
      images: 2,
      pictures: 0,
      shaders: 0,
      paints: 0,
      imageFilters: 0,
    });
    rasters.dispose();
    comp.dispose();
    fonts.dispose();
    expect(c.total()).toBe(0);
  });

  it('re-rasters only on a key change; the replaced image is retired, then disposed', async () => {
    const { c, fonts, comp, rasters } = setup();
    await fonts.ensure(['Montserrat']);
    const doc = tracks({ t1: 'Hello' });
    for (let k = 0; k < 120; k += 1) {
      rasters.sync(doc, 320, 180, 640, fonts.version); // a playing frame: nothing changes
      comp.endFrame();
    }
    expect(rasters.rastered).toBe(1);
    rasters.sync(tracks({ t1: 'Hello!' }), 320, 180, 640, fonts.version); // an edit
    expect(rasters.rastered).toBe(2);
    expect(c.live().images).toBe(2); // the old one is retired, not yet disposed
    for (let k = 0; k < RETIRE_FRAMES; k += 1) comp.endFrame();
    expect(c.live().images).toBe(1);
    rasters.sync(tracks({ t1: 'Hello!' }), 160, 90, 640, fonts.version); // a resize
    rasters.sync(tracks({}), 160, 90, 640, fonts.version); // the clip is deleted
    for (let k = 0; k < RETIRE_FRAMES; k += 1) comp.endFrame();
    expect(c.live().images).toBe(0);
    rasters.dispose();
    comp.dispose();
    fonts.dispose();
    expect(c.total()).toBe(0);
  });

  it('a raster drawn through the compositor chain like video, and released with it', async () => {
    const { c, fonts, comp, rasters } = setup();
    await fonts.ensure(['Montserrat']);
    rasters.sync(tracks({ t1: 'On top' }), 64, 36, 640, fonts.version);
    const surface = c.api.Surface.MakeRaster(64, 36)!;
    for (let k = 0; k < 30; k += 1) {
      comp.draw(
        surface.getCanvas(),
        [
          {
            key: 't1',
            layer: { slot: -1, srcW: 64, srcH: 36, opacity: k / 30, imageKey: 't1' },
            source: { kind: 'image', image: rasters.image('t1')! },
          },
        ],
        64,
        36,
      );
      comp.endFrame();
    }
    expect(comp.chainOf('t1')!.made).toBeLessThanOrEqual(1 + 2 * 30); // source once; geometry once; alpha per opacity step
    surface.dispose();
    rasters.dispose();
    comp.dispose();
    fonts.dispose();
    expect(c.total()).toBe(0);
  });
});
