/**
 * @jest-environment node
 *
 * MA62 decision 0 (MA60's disposal rule) for the whole preview, in the `compositorLifetime.test.ts`
 * style: the per-frame body (`previewFrame.ts`) over a project with a transition (crossDissolve and
 * a dip), a title and captions, on the counting CanvasKit API. Counted: surfaces, images, pictures,
 * shaders, paints, image filters (`countingApi`) and paragraphs (counted here). Bounded while
 * playing, constant while paused, 0 after dispose. jest is CPU: the phone check is `dumpsys
 * meminfo` Graphics (the device-check script in the ticket).
 */
import type { SkImage, SkParagraph } from 'react-native-skia';
import { countingApi } from '../../../../photo/skia/testing/countingApi';
import { loadSkiaApi } from '../../../../photo/skia/testing/skiaTestApi';
import type { StudioCaptionCue, StudioTrack } from '../../../studioTypes';
import type { GpuFrameSink } from '../../player/gpuFrameSink';
import { createPumpState } from '../../player/framePump';
import { idleControl, type ClockControl } from '../../player/slotControl';
import { SLOT_COUNT } from '../../player/types';
import { clip, lane } from '../../player/testing/sim';
import { Compositor, RETIRE_FRAMES, type SkiaApi } from '../compositor/compositor';
import { createFrameState, disposeFrame, ensureSurface, previewFrame, type FrameScene } from '../previewFrame';
import { CaptionTimeline } from '../text/captionTimeline';
import { createStudioFonts } from '../text/fonts';
import { BUNDLED_FONTS_FILES } from '../text/testing/bundledFiles';
import { fontBytes } from '../text/testing/canvas2d';
import { TitleRasters } from '../text/titleRasters';

jest.setTimeout(180_000);

let base: SkiaApi;
beforeAll(async () => {
  base = await loadSkiaApi();
});

const W = 64;
const H = 36;

const TRACKS: StudioTrack[] = [
  lane('v1', 0, [
    clip({ id: 'a', timelineStart: 0, sourceOut: 4 }),
    clip({ id: 'b', timelineStart: 3, sourceOut: 4, assetId: 'a2', transition: { type: 'dipToBlack', durationSeconds: 1 } }),
    clip({ id: 'c', timelineStart: 6, sourceOut: 4, assetId: 'a3', transition: { type: 'crossDissolve', durationSeconds: 1 }, opacity: 0.9 }),
  ]),
  lane('v2', 1, [
    {
      ...clip({ id: 'title', timelineStart: 1, sourceOut: 6 }),
      assetId: '',
      title: {
        layers: [
          { type: 'rect', x: 0.1, y: 0.6, w: 0.8, h: 0.3, color: '#101828', opacity: 0.8 },
          { type: 'text', text: 'Title', fontFamily: 'Inter', fontSizePx: 40, fontWeight: 700, fillColor: '#FFFFFF', align: 'center', x: 0.5, y: 0.75, shadow: { xPx: 2, yPx: 2, blurPx: 3, color: '#000000' } },
        ],
      },
      keyframes: { opacity: [{ t: 0, value: 0, ease: 'linear' }, { t: 1, value: 1, ease: 'linear' }] },
    },
  ]),
];
const CUES: StudioCaptionCue[] = [
  {
    id: 'q1',
    startSeconds: 0.5,
    endSeconds: 5,
    text: 'Captions move with every word',
    words: [
      { text: 'Captions', startSeconds: 0.5, endSeconds: 1 },
      { text: 'move', startSeconds: 1.1, endSeconds: 1.5 },
      { text: 'with', startSeconds: 1.6, endSeconds: 2 },
      { text: 'every', startSeconds: 2.1, endSeconds: 2.5, emphasis: true },
      { text: 'word', startSeconds: 2.6, endSeconds: 5 },
    ],
  },
];

/** A sink with one image per slot (real CanvasKit images, made once: MA76's rule). */
function sink(api: SkiaApi): GpuFrameSink {
  const images: (SkImage | null)[] = Array.from({ length: SLOT_COUNT }, () => null);
  for (let i = 0; i < 3; i += 1) {
    const bytes = new Uint8Array(16 * 9 * 4).map((_, k) => (k % 4 === 3 ? 255 : (k * (i + 3)) % 256));
    images[i] = api.Image.MakeRaster({ width: 16, height: 9, colorType: 4, alphaType: 1 }, api.Data.fromBytes(bytes), 64);
  }
  return {
    images,
    imageGen: () => 1,
    copy: (_s, f) => {
      f.release();
      return true;
    },
    endFrame() {},
    dispose() {
      for (let i = 0; i < SLOT_COUNT; i += 1) {
        images[i]?.dispose();
        images[i] = null;
      }
    },
  };
}

async function setup() {
  const c = countingApi(base);
  const paragraphs = new Set<SkParagraph>();
  const watch = (p: SkParagraph) => {
    paragraphs.add(p);
    const d = p.dispose.bind(p);
    p.dispose = () => {
      paragraphs.delete(p);
      d();
    };
  };
  const fonts = createStudioFonts({
    api: c.api,
    bundled: BUNDLED_FONTS_FILES,
    loadBundled: async (file) => {
      const b = fontBytes(String(file));
      return c.api.Data.fromBytes(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
    },
    loadDownloaded: async () => null,
  });
  await fonts.ensure(['Inter', 'Montserrat']);
  const comp = new Compositor(c.api);
  const retire = (o: { dispose?: () => void }) => comp.retire(o);
  const titles = new TitleRasters({ api: c.api, fonts: fonts.provider, makeSurface: (w, h) => c.api.Surface.MakeRaster(w, h), retire, onParagraph: watch });
  const captions = new CaptionTimeline({ api: c.api, fonts: fonts.provider, makeSurface: (w, h) => c.api.Surface.MakeRaster(w, h), retire, onParagraph: watch });
  const sk = sink(c.api);
  const st = createFrameState();
  st.W = W;
  st.H = H;
  const deps = { api: c.api, compositor: comp, sink: sk };
  ensureSurface(st, deps);
  titles.sync(TRACKS, W, H, 640, fonts.version);
  captions.sync(CUES, { fontSizePct: 6, color: '#FFFFFF', backgroundColor: '#000000', backgroundOpacity: 0.6, position: 'bottom', maxWidthPct: 90, fontFamily: 'Montserrat', outlineWidth: 4, shadow: 0.5, animation: 'pop', wordsPerGroup: 3, highlightColor: '#FFD400' }, true, W, H, 360, fonts.version);
  const scene: FrameScene = {
    seq: 1,
    tracks: TRACKS,
    projectW: 640,
    projectH: 360,
    fps: 30,
    slotOf: { a: 0, b: 1, c: 2 },
    titleOf: titles.images(),
    luts: [],
    safe: false,
    captions: captions.track(),
  };
  const controls = [idleControl(), idleControl(), idleControl(), idleControl()];
  const players = [null, null, null, null];
  return { c, fonts, comp, titles, captions, sk, st, deps, scene, controls, players, paragraphs };
}

function frames(s: Awaited<ReturnType<typeof setup>>, fromT: number, n: number, playing: boolean, onFrame?: () => void) {
  let now = 0;
  for (let k = 0; k < n; k += 1) {
    now += 1000 / 60;
    const clock: ClockControl = { seq: playing ? 1 : 2, playing: playing ? 1 : 0, t0: fromT, frameMs: 1000 / 30 };
    previewFrame(s.st, s.deps, s.scene, s.controls, s.players, clock, now);
    onFrame?.();
  }
}

describe('the preview frame loop: GPU object lifetimes (counting proxy)', () => {
  it('playing through a dip, a dissolve, a keyframed title and captions: bounded, 0 after dispose', async () => {
    const s = await setup();
    s.st.pump = createPumpState();
    let maxShaders = 0;
    let maxPaints = 0;
    let maxImages = 0;
    frames(s, 0, 9 * 60, true, () => {
      const l = s.c.live();
      maxShaders = Math.max(maxShaders, l.shaders);
      maxPaints = Math.max(maxPaints, l.paints);
      maxImages = Math.max(maxImages, l.images);
    });
    // Up to 5 layers (2 video, dip, title, captions), each <= 4 live stage shaders + its source,
    // plus the shaders retired in the last RETIRE_FRAMES frames (a moving layer remakes <= 3).
    expect(maxShaders).toBeLessThanOrEqual(5 * 5 + 5 * 3 * RETIRE_FRAMES);
    // One paint per chain, the background, the caption painter's three.
    expect(maxPaints).toBeLessThanOrEqual(5 + 1 + 3);
    // 3 slot images + 1 title + caption segments + the surface's image (+ retired copies).
    expect(maxImages).toBeLessThanOrEqual(3 + 1 + s.captions.images.length + 1 + 2);
    expect(s.paragraphs.size).toBe(0); // no paragraph outlives a raster, none is built per frame
    disposeFrame(s.st, s.deps);
    s.titles.dispose();
    s.captions.dispose();
    s.fonts.dispose();
    expect(s.c.live()).toEqual({ surfaces: 0, images: 0, pictures: 0, shaders: 0, paints: 0, imageFilters: 0 });
  });

  it('paused: no draw, no shader, no paint, no image per frame', async () => {
    const s = await setup();
    frames(s, 3.5, 5, false);
    const before = { ...s.c.live(), drawn: s.st.drawn };
    frames(s, 3.5, 300, false);
    const after = s.c.live();
    expect(s.st.drawn).toBe(before.drawn);
    expect(after.shaders).toBe(before.shaders);
    expect(after.paints).toBe(before.paints);
    expect(after.images).toBe(before.images);
    disposeFrame(s.st, s.deps);
    s.titles.dispose();
    s.captions.dispose();
    s.fonts.dispose();
    expect(s.c.total()).toBe(0);
  });

  it('captions and titles are recorded once, not per frame', async () => {
    const s = await setup();
    const recorded = s.captions.recorded;
    const rastered = s.titles.rastered;
    frames(s, 0, 300, true);
    expect(s.captions.recorded).toBe(recorded);
    expect(s.titles.rastered).toBe(rastered);
    expect(recorded).toBeGreaterThan(3); // a segment per group / word / pulse slice
    disposeFrame(s.st, s.deps);
    s.titles.dispose();
    s.captions.dispose();
    s.fonts.dispose();
    expect(s.c.total()).toBe(0);
  });
});
