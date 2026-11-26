/**
 * @jest-environment node
 *
 * `<StudioPreview>`'s controller (MA62 S4, decision 1) end to end without a device: fake
 * `createVideoPlayer` players (S1's MA59-behaved fakes), the real pump and the real per-frame
 * body (`previewFrame.ts`) on CanvasKit, a fake GPU sink whose slot images are real Skia images, a
 * 60 Hz UI loop and the 100 ms / 1 s JS timers on one virtual clock. Checks: play / pause / seek /
 * isPlaying, the scene is published only on change, the loop redraws only when something
 * changed, safe mode (GPU unavailable, low fps, toggle) reaches the pool and the scene, and the
 * perf aggregate goes out every 60 s of playing.
 */
import type { SkImage } from 'react-native-skia';
import type { StudioPerfSampleProps } from '@/analytics/events';
import { loadSkiaApi } from '../../../../photo/skia/testing/skiaTestApi';
import type { StudioTrack } from '../../../studioTypes';
import type { GpuFrameSink } from '../../player/gpuFrameSink';
import { TICK_MS } from '../../player/PreviewDriver';
import { fakeFactory, memoryBridge } from '../../player/testing/fakePlayers';
import { clip, lane, simMedia } from '../../player/testing/sim';
import { SLOT_COUNT, type PreviewPlayer } from '../../player/types';
import { Compositor, type SkiaApi } from '../compositor/compositor';
import { PreviewController, safeTracks, type PreviewDoc } from '../previewController';
import { createFrameState, ensureSurface, previewFrame, type FrameScene } from '../previewFrame';
import type { SafeModeReason } from '../safeMode';

jest.setTimeout(120_000);

const FRAME_MS = 1000 / 60;
let api: SkiaApi;
beforeAll(async () => {
  api = await loadSkiaApi();
});

/** A GPU sink stand-in: one real raster image per slot, made on the first copy (MA76's rule). */
function imageSink(): GpuFrameSink & { copies: number } {
  const images: (SkImage | null)[] = Array.from({ length: SLOT_COUNT }, () => null);
  const st = { gen: 0, copies: 0 };
  return {
    images,
    get copies() {
      return st.copies;
    },
    imageGen: () => st.gen,
    copy(slot, frame) {
      if (!images[slot]) {
        const bytes = new Uint8Array(16 * 9 * 4).fill(200);
        images[slot] = api.Image.MakeRaster({ width: 16, height: 9, colorType: 4, alphaType: 1 }, api.Data.fromBytes(bytes), 64);
        st.gen += 1;
      }
      st.copies += 1;
      frame.release();
      return true;
    },
    endFrame() {},
    dispose() {
      for (let i = 0; i < SLOT_COUNT; i += 1) {
        images[i]?.dispose();
        images[i] = null;
      }
    },
  } as GpuFrameSink & { copies: number };
}

function setup(opts: { gpu?: 'ok' | 'unavailable' | null; doc?: Partial<PreviewDoc> } = {}) {
  const tracks: StudioTrack[] = [
    lane('v1', 0, [clip({ id: 'a', timelineStart: 0, sourceOut: 10 }), clip({ id: 'b', timelineStart: 9, sourceOut: 10, assetId: 'a2', transition: { type: 'crossDissolve', durationSeconds: 1 } })]),
    lane('v2', 1, [clip({ id: 'top', timelineStart: 2, sourceOut: 4, assetId: 'a3' })]),
  ];
  const doc: PreviewDoc = { tracks, fps: 30, width: 640, height: 360, ...opts.doc };
  const fakes = fakeFactory({ a1: { duration: 300 }, a2: { duration: 300 }, a3: { duration: 300 } });
  const bridge = memoryBridge();
  const sink = imageSink();
  const comp = new Compositor(api);
  const st = createFrameState();
  st.W = 64;
  st.H = 36;
  // The pump's outputs as the app reads them back (numeric shared values mirrored from st.pump).
  const feedback = {
    frames: (i: number) => st.pump.frames[i]!,
    landedSeq: (i: number) => st.pump.landedSeq[i]!,
    latencyMs: (i: number) => st.pump.latencyMs[i]!,
  };
  const scenes: FrameScene[] = [];
  const safeReports: SafeModeReason[] = [];
  const perf: StudioPerfSampleProps[] = [];
  let gpu: 'ok' | 'unavailable' | null = opts.gpu === undefined ? 'ok' : opts.gpu;
  const ctl = new PreviewController(
    {
      pool: { factory: fakes.factory, media: simMedia({ a1: {}, a2: {}, a3: {} }), sink: bridge.sink, feedback, fps: 30 },
      publishScene: (s) => scenes.push(s),
      counters: { drawn: () => st.drawn, frames: (i) => st.pump.frames[i]! },
      text: { titles: () => null, captions: () => undefined },
      gpu: () => gpu,
      trackSafeMode: (r) => safeReports.push(r),
      sendPerf: (p) => perf.push(p),
      heapBytes: () => 50 * 2 ** 20,
      deviceClass: 'high',
    },
    doc,
  );
  ctl.setSize(64, 36);
  ensureSurface(st, { api, compositor: comp, sink });
  let now = 0;
  let nextTick = TICK_MS;
  let nextSample = 1000;
  let redraws = 0;
  /** `slow`: frames the UI loop skips (to simulate a phone that cannot keep up). */
  const frame = (slow = 0) => {
    now += FRAME_MS * (1 + slow);
    for (const p of fakes.made) p.advance(now);
    const scene = scenes[scenes.length - 1]!;
    if (previewFrame(st, { api, compositor: comp, sink }, scene, bridge.controls, bridge.players as (PreviewPlayer | null)[], bridge.clock, now)) redraws += 1;
    if (now >= nextTick) {
      nextTick += TICK_MS;
      ctl.tick(now);
    }
    if (now >= nextSample) {
      nextSample += 1000;
      ctl.sample(now);
    }
  };
  return {
    ctl,
    fakes,
    st,
    scenes,
    safeReports,
    perf,
    setGpu: (g: 'ok' | 'unavailable' | null) => (gpu = g),
    run(ms: number, slow = 0) {
      const end = now + ms;
      while (now < end) frame(slow);
    },
    get now() {
      return now;
    },
    get redraws() {
      return redraws;
    },
    dispose() {
      ctl.dispose();
      comp.dispose();
      sink.dispose();
      st.surface?.dispose();
    },
  };
}

describe('the controller (play / pause / seek / isPlaying)', () => {
  it('plays from 0, advances, pauses where it is, seeks, and draws the slot images', () => {
    const s = setup();
    expect(s.ctl.isPlaying).toBe(false);
    s.run(300);
    s.ctl.play(s.now);
    expect(s.ctl.isPlaying).toBe(true);
    s.run(3000);
    expect(s.ctl.t).toBeGreaterThan(2.5);
    expect(s.ctl.t).toBeLessThan(3.5);
    s.ctl.pause(s.now);
    const at = s.ctl.t;
    s.run(1000);
    expect(s.ctl.isPlaying).toBe(false);
    expect(s.ctl.t).toBe(at);
    s.ctl.seek(9.5, s.now);
    s.run(600);
    expect(s.ctl.t).toBe(9.5);
    // In the dissolve: both v1 clips have slots in the scene.
    const scene = s.scenes[s.scenes.length - 1]!;
    expect(Object.keys(scene.slotOf).sort()).toEqual(['a', 'b']);
    expect(s.st.drawn).toBeGreaterThan(0);
    s.dispose();
  });

  it('the scene is published on change only, and a paused, settled preview redraws nothing', () => {
    const s = setup();
    s.run(1000);
    const published = s.scenes.length;
    const drawn = s.st.drawn;
    s.run(5000); // paused, nothing changes
    expect(s.scenes.length).toBe(published);
    expect(s.st.drawn).toBe(drawn);
    s.dispose();
  });

  it('while playing, the loop redraws at most once per UI frame and at least once per project frame', () => {
    const s = setup();
    s.run(300);
    s.ctl.play(s.now);
    s.run(2000);
    const before = s.st.drawn;
    s.run(2000);
    const n = s.st.drawn - before;
    expect(n).toBeGreaterThanOrEqual(55); // 30 project frames/s over 2 s, minus a landing
    expect(n).toBeLessThanOrEqual(121);
    s.dispose();
  });
});

describe('safe mode through the controller', () => {
  it('GPU unavailable at mount: safe from the start, one slot, reported once', () => {
    const s = setup({ gpu: 'unavailable' });
    expect(s.ctl.safeMode).toBe(true);
    expect(s.safeReports).toEqual(['gpu_unavailable']);
    s.ctl.seek(3, s.now);
    s.run(800);
    const scene = s.scenes[s.scenes.length - 1]!;
    expect(scene.safe).toBe(true);
    expect(Object.keys(scene.slotOf)).toEqual(['top']); // the top-most visible clip only
    s.ctl.setSafeMode(false); // cannot leave without a GPU
    expect(s.ctl.safeMode).toBe(true);
    s.dispose();
  });

  it('a slow loop (< 15 fps) for 5 s while playing enters low_fps; the toggle leaves it', () => {
    const s = setup();
    s.run(300);
    s.ctl.play(s.now);
    s.run(8000, 5); // one UI frame in 6: ~10 fps composited
    expect(s.ctl.safeMode).toBe(true);
    expect(s.safeReports).toEqual(['low_fps']);
    s.ctl.setSafeMode(false);
    expect(s.ctl.safeMode).toBe(false);
    s.ctl.setSafeMode(true);
    expect(s.safeReports).toEqual(['low_fps', 'user_toggle']);
    s.dispose();
  });

  it('the capability answer arriving late switches safe mode on', () => {
    const s = setup({ gpu: null });
    expect(s.ctl.safeMode).toBe(false);
    s.setGpu('unavailable');
    s.ctl.capabilityKnown();
    expect(s.ctl.safeMode).toBe(true);
    s.dispose();
  });

  it('safeTracks keeps the top-most visible video clip and every title', () => {
    const tracks = [
      lane('v1', 0, [clip({ id: 'a', timelineStart: 0 })]),
      lane('v2', 1, [clip({ id: 'b', timelineStart: 0 })]),
      lane('v3', 2, [clip({ id: 'hidden', timelineStart: 0 })], { hidden: true }),
      lane('v4', 3, [{ ...clip({ id: 't', timelineStart: 0 }), assetId: '', title: { layers: [] } }]),
    ];
    const out = safeTracks(tracks, 1);
    expect(out.flatMap((tr) => tr.clips.map((c) => c.id))).toEqual(['b', 't']);
  });
});

describe('perf telemetry through the controller', () => {
  it('one studio_perf_sample per 60 s of playing, with slots and device class; none while paused', () => {
    const s = setup({ doc: { tracks: [lane('v1', 0, [clip({ id: 'long', timelineStart: 0, sourceOut: 200 })])] } });
    s.run(30_000);
    expect(s.perf).toHaveLength(0);
    s.ctl.play(s.now);
    s.run(62_000);
    expect(s.perf.length).toBe(1);
    expect(s.perf[0]).toMatchObject({ host: 'mm', deviceClass: 'high', safeMode: false, jsHeapMbBucket: '<64' });
    expect(s.perf[0]!.slots).toBeGreaterThanOrEqual(1);
    expect(s.perf[0]!.fpsBucket).toBeDefined();
    s.dispose();
  });
});
