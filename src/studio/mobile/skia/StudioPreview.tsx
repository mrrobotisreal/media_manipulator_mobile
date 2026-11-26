/* eslint-disable react-hooks/immutability -- reanimated shared values are mutated by design (`.value =`). */
/**
 * `<StudioPreview store={…} />` (ticket MA62 decision 1): the Darkroom preview, a Skia canvas sized
 * to the project's aspect and letterboxed, driven by a Reanimated `useFrameCallback` on the UI
 * runtime. Built from MA76's proven loop (`evidence/MA76-spike-screen.tsx.txt`,
 * `img=reuse&alloc=none&log=0`), with every rule of decision 0:
 *
 * UI runtime (`useFrameCallback`, once per display frame; `previewFrame.ts`, allocation-free when
 * nothing changes, no logging):
 * - `installWebGPU()` once per runtime (a flag on the runtime's `globalThis`);
 * - the S1 pump: seeks, frame-steps, `copyLatestFrame()` -> `queue.copyExternalImageToTexture`
 *   into ONE texture and ONE `SkImage` per slot (`gpuFrameSink.ts`), frames released at once;
 * - when something changed: the copied resolver plans the layers at t, the compositor draws them
 *   into ONE offscreen surface (per canvas size) and flushes; the canvas draws that surface's one
 *   `asImage()`; a numeric `redraw` shared value the scene reads is toggled (MA76 rule 2);
 * - the pump's outputs are mirrored into numeric shared values per slot (frames, landed seek,
 *   latency) and a `drawn` counter: numbers only, no array copied per tick (rule 3).
 *
 * JS thread (`previewController.ts`): a 100 ms timer (the S1 driver: pool, clock, drift, volumes;
 * publishes `SlotControl` / `ClockControl` objects into shared values only when they change) and a
 * 1 s timer (fps, safe mode, the 60 s perf aggregate). The scene the loop draws (tracks, slot map,
 * title and caption images, safe flag) crosses in one shared value, written only on change. No
 * JS-thread loop reads UI shared values per frame (rule 1); the canvas scene is memoised and the
 * stats live in the caller's isolated component (rule 4).
 *
 * What crosses runtimes and how often: JS -> UI on change only (controls, players, clock anchor
 * every ~100 ms while playing, scene on edits / slot changes / re-rasters); UI -> JS the numeric
 * counters, read by the JS timers (10 Hz and 1 Hz). Skia and WebGPU host objects cross through
 * their own Worklets serializers (registered by react-native-skia and react-native-webgpu).
 *
 * The controller hook (`useStudioPreviewController`) is what the editor's transport uses:
 * `play / pause / seek(t) / isPlaying`, plus the safe-mode toggle.
 */
import { Canvas, Image as SkiaImage, Rect, Skia, type SkImage } from 'react-native-skia';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, PixelRatio, View, type LayoutChangeEvent } from 'react-native';
import * as Device from 'expo-device';
import { useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { createVideoPlayer, importDevice, installWebGPU } from 'react-native-webgpu';
import { EVENTS, track } from '@/analytics/track';
import { checkGpuCapability, gpuEditors } from '@/gpu/capability';
import { createGpuFrameSink } from '../player/gpuFrameSink';
import { idleControl, type ClockControl, type SlotControl } from '../player/slotControl';
import { SLOT_COUNT, type PreviewPlayer } from '../player/types';
import type { PoolMedia } from '../player/VideoPool';
import type { StudioStore } from '../studioStore';
import { Compositor } from './compositor/compositor';
import { deviceClassOf, hermesHeapBytes } from './perf';
import { PreviewController, type PreviewDoc, type TextLayers } from './previewController';
import { createFrameState, disposeFrame, ensureSurface, previewFrame, type FrameScene, type FrameState } from './previewFrame';
import type { SafeModeReason } from './safeMode';
import { CaptionTimeline } from './text/captionTimeline';
import { projectFamilies } from './text/fonts';
import { studioFonts } from './text/fontsRuntime';
import { TitleRasters } from './text/titleRasters';

/** The project frame is rastered at most this long on its long edge (the web's MAX_BACKING_DIM). */
const MAX_BACKING_DIM = 1920;
const TICK_MS = 100;
const SAMPLE_MS = 1000;

export interface StudioPreviewHandle {
  play(): void;
  pause(): void;
  seek(t: number): void;
  readonly isPlaying: boolean;
  readonly t: number;
  setSafeMode(on: boolean): void;
  readonly safeMode: boolean;
  /** Composited fps over the last second (dev readout). */
  readonly fps: number;
  /** Decoding video slots right now. */
  readonly slots: number;
}

/** The handle the transport uses; `ref` is filled by `<StudioPreview controller={ref} />`. */
export function useStudioPreviewController() {
  return useRef<StudioPreviewHandle | null>(null);
}

export interface StudioPreviewProps {
  store: StudioStore;
  /** Where each clip's media is on the phone (`PoolMedia`: the studio media cache, MA61). */
  media: PoolMedia;
  controller?: { current: StudioPreviewHandle | null };
  /** The chip and any overlay, given the safe flag (the dev screen passes its readout). */
  overlay?: (state: { safe: boolean; reason: SafeModeReason | null }) => ReactNode;
  /** Test hook: the player factory (default `createVideoPlayer`). */
  factory?: (uri: string) => PreviewPlayer;
}

function docOf(store: StudioStore): PreviewDoc | null {
  const d = store.getState().doc;
  if (!d) return null;
  return {
    tracks: d.tracks,
    audio: d.audio,
    fps: d.fps,
    width: d.width,
    height: d.height,
    captions: d.captions,
    captionStyle: d.captionStyle ?? null,
    captionsEnabled: d.captionsEnabled,
  };
}

/** The backing size for a project at the canvas's pixel size (aspect kept, long edge capped). */
function backingSize(pw: number, ph: number, viewW: number, viewH: number, scale: number): { W: number; H: number } {
  const fit = Math.min(viewW / pw, viewH / ph);
  let W = Math.round(pw * fit * scale);
  let H = Math.round(ph * fit * scale);
  const long = Math.max(W, H);
  if (long > MAX_BACKING_DIM) {
    W = Math.round((W * MAX_BACKING_DIM) / long);
    H = Math.round((H * MAX_BACKING_DIM) / long);
  }
  return { W: Math.max(2, W), H: Math.max(2, H) };
}

/** Per-slot shared values (numbers and the control objects), created once. */
function useSlotValues() {
  const c0 = useSharedValue<SlotControl>(idleControl());
  const c1 = useSharedValue<SlotControl>(idleControl());
  const c2 = useSharedValue<SlotControl>(idleControl());
  const c3 = useSharedValue<SlotControl>(idleControl());
  const f0 = useSharedValue(0);
  const f1 = useSharedValue(0);
  const f2 = useSharedValue(0);
  const f3 = useSharedValue(0);
  const l0 = useSharedValue(0);
  const l1 = useSharedValue(0);
  const l2 = useSharedValue(0);
  const l3 = useSharedValue(0);
  const m0 = useSharedValue(0);
  const m1 = useSharedValue(0);
  const m2 = useSharedValue(0);
  const m3 = useSharedValue(0);
  return useMemo(
    () => ({
      controls: [c0, c1, c2, c3],
      frames: [f0, f1, f2, f3],
      landed: [l0, l1, l2, l3],
      latency: [m0, m1, m2, m3],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
}

export function StudioPreview({ store, media, controller, overlay, factory }: StudioPreviewProps) {
  const [doc, setDoc] = useState<PreviewDoc | null>(() => docOf(store));
  const [view, setView] = useState({ w: 0, h: 0 });
  const [safe, setSafe] = useState<{ on: boolean; reason: SafeModeReason | null }>({ on: false, reason: null });

  // --- shared values (numbers and change-only objects; decision 0) ----------------------------
  const slots = useSlotValues();
  const players = useSharedValue<(PreviewPlayer | null)[]>([null, null, null, null]);
  const clock = useSharedValue<ClockControl>({ seq: 0, playing: 0, t0: 0, frameMs: 1000 / 30 });
  const scene = useSharedValue<FrameScene | null>(null);
  const size = useSharedValue({ W: 0, H: 0 });
  const redraw = useSharedValue(0);
  const drawn = useSharedValue(0);
  const image = useSharedValue<SkImage | null>(null);
  const live = useSharedValue(true);
  /** The UI-runtime state (created on the UI runtime on the first frame; an object, not a closure var). */
  const ui = useSharedValue<{ st: FrameState; deps: Parameters<typeof previewFrame>[1]; controls: SlotControl[] } | null>(null);

  // --- the UI-runtime loop (decision 0) -------------------------------------------------------
  useFrameCallback((fi) => {
    'worklet';
    const g = globalThis as unknown as { __ma62wgpu?: boolean };
    if (!g.__ma62wgpu) {
      installWebGPU();
      g.__ma62wgpu = true;
    }
    const sc = scene.value;
    if (!sc || !live.value) return;
    let u = ui.value;
    if (!u) {
      // One-time setup on the UI runtime: the shared Dawn device, the sink, the compositor.
      const device = importDevice(Skia.getNativeDevice());
      const format = (globalThis as unknown as { navigator: { gpu: GPU } }).navigator.gpu.getPreferredCanvasFormat();
      u = {
        st: createFrameState(),
        deps: { api: Skia, compositor: new Compositor(Skia), sink: createGpuFrameSink(device as never, format, Skia as never) },
        controls: [idleControl(), idleControl(), idleControl(), idleControl()],
      };
      ui.value = u;
    }
    const st = u.st;
    const sz = size.value;
    st.W = sz.W;
    st.H = sz.H;
    if (ensureSurface(st, u.deps)) image.value = st.image;
    // Read the controls in place (one property read per slot, no array per frame).
    for (let i = 0; i < SLOT_COUNT; i += 1) u.controls[i] = slots.controls[i]!.value;
    const did = previewFrame(st, u.deps, sc, u.controls, players.value, clock.value, fi.timestamp);
    // Mirror the pump's outputs into numeric shared values (read by the JS timers).
    for (let i = 0; i < SLOT_COUNT; i += 1) {
      if (slots.frames[i]!.value !== st.pump.frames[i]) slots.frames[i]!.value = st.pump.frames[i]!;
      if (slots.landed[i]!.value !== st.pump.landedSeq[i]) slots.landed[i]!.value = st.pump.landedSeq[i]!;
      if (slots.latency[i]!.value !== st.pump.latencyMs[i]) slots.latency[i]!.value = st.pump.latencyMs[i]!;
    }
    if (did) {
      drawn.value = st.drawn;
      redraw.value = redraw.value === 0 ? 1 : 0;
    }
  });

  // --- the JS side ---------------------------------------------------------------------------
  const ctlRef = useRef<PreviewController | null>(null);
  useEffect(() => {
    const d0 = docOf(store);
    if (!d0) return undefined;
    let disposed = false;
    const fonts = studioFonts();
    const titles = new TitleRasters({
      api: Skia,
      fonts: fonts.provider,
      makeSurface: (w, h) => Skia.Surface.MakeOffscreen(w, h),
      // The UI runtime's compositor retires frame objects; these images are JS-owned: dispose them
      // a second later (the canvas may still draw the old one, MA60's `disposeLater` rule).
      retire: (o) => setTimeout(() => o.dispose?.(), 1000),
    });
    const captions = new CaptionTimeline({
      api: Skia,
      fonts: fonts.provider,
      makeSurface: (w, h) => Skia.Surface.MakeOffscreen(w, h),
      retire: (o) => setTimeout(() => o.dispose?.(), 1000),
    });
    const text: TextLayers = {
      titles: (doc, W, H, t) => (titles.sync(doc.tracks, W, H, doc.width, fonts.version, t) ? titles.images() : null),
      captions: (doc, W, H) =>
        captions.sync(doc.captions ?? [], doc.captionStyle, doc.captionsEnabled !== false, W, H, doc.height, fonts.version)
          ? captions.images.length
            ? captions.track()
            : null
          : undefined,
    };
    const ctl = new PreviewController(
      {
        pool: {
          factory: factory ?? ((uri) => createVideoPlayer(uri) as unknown as PreviewPlayer),
          media,
          fps: d0.fps,
          sink: {
            setControl: (i, c) => {
              slots.controls[i]!.value = c;
            },
            setPlayers: (p) => {
              players.value = p.slice() as (PreviewPlayer | null)[];
            },
            setClock: (c) => {
              clock.value = c;
            },
          },
          feedback: {
            frames: (i) => slots.frames[i]!.value,
            landedSeq: (i) => slots.landed[i]!.value,
            latencyMs: (i) => slots.latency[i]!.value,
          },
        },
        publishScene: (s) => {
          scene.value = s;
        },
        counters: { drawn: () => drawn.value, frames: (i) => slots.frames[i]!.value },
        text,
        gpu: () => gpuEditors(),
        trackSafeMode: (reason) => track(EVENTS.STUDIO_SAFE_MODE_ENTERED, { reason }),
        sendPerf: (props) => track(EVENTS.STUDIO_PERF_SAMPLE, props),
        heapBytes: hermesHeapBytes,
        deviceClass: deviceClassOf(Device.totalMemory),
        onSafeChange: (on, reason) => {
          if (!disposed) setSafe({ on, reason });
        },
      },
      d0,
      store.getState().playhead,
    );
    ctlRef.current = ctl;
    // Fonts the project names: load, then re-raster (the fonts version changes the title keys).
    void fonts.ensure(projectFamilies({ tracks: d0.tracks, captionStyle: d0.captionStyle })).then(() => {
      if (!disposed) {
        const d = docOf(store);
        if (d) ctl.setDoc(d);
      }
    });
    void checkGpuCapability().then(() => {
      if (!disposed) ctl.capabilityKnown();
    });
    const tick = setInterval(() => ctl.tick(performance.now()), TICK_MS);
    const sample = setInterval(() => ctl.sample(performance.now()), SAMPLE_MS);
    // Document edits: the store's doc object changes on every edit (immutable updates).
    let lastDoc = store.getState().doc;
    const unsub = store.subscribe(() => {
      const next = store.getState().doc;
      if (next === lastDoc) return;
      lastDoc = next;
      const d = docOf(store);
      if (d) setDoc(d);
    });
    if (controller) {
      controller.current = {
        play: () => ctl.play(performance.now()),
        pause: () => ctl.pause(performance.now()),
        seek: (t) => ctl.seek(t, performance.now()),
        get isPlaying() {
          return ctl.isPlaying;
        },
        get t() {
          return ctl.t;
        },
        setSafeMode: (on) => ctl.setSafeMode(on),
        get safeMode() {
          return ctl.safeMode;
        },
        get fps() {
          return ctl.fps;
        },
        get slots() {
          return Object.keys(scene.value?.slotOf ?? {}).length;
        },
      };
    }
    // Background pauses (and sends the partial perf window); foreground resumes if it was playing.
    let resume = false;
    const app = AppState.addEventListener('change', (s) => {
      if (s === 'background' || s === 'inactive') {
        resume = resume || ctl.isPlaying;
        if (ctl.isPlaying) ctl.pause(performance.now());
        ctl.flushPerf();
      } else if (s === 'active' && resume) {
        resume = false;
        ctl.play(performance.now());
      }
    });
    return () => {
      disposed = true;
      app.remove();
      unsub();
      clearInterval(tick);
      clearInterval(sample);
      if (controller) controller.current = null;
      ctl.dispose();
      ctlRef.current = null;
      live.value = false;
      scene.value = null;
      // The UI runtime releases its textures, surface and shaders on its own thread.
      const u = ui;
      setTimeout(() => {
        const state = u.value;
        if (state) disposeFrame(state.st, state.deps);
        u.value = null;
        image.value = null;
        titles.dispose();
        captions.dispose();
      }, 1000);
    };
    // The preview is mounted per project: the store is the identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  // Document edits reach the controller (not per frame: on store changes).
  useEffect(() => {
    if (doc) ctlRef.current?.setDoc(doc);
  }, [doc]);

  // The canvas size -> the backing size (the project's aspect at the view's pixels, capped).
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setView((v) => (v.w === width && v.h === height ? v : { w: width, h: height }));
  }, []);
  const pw = doc?.width ?? 16;
  const ph = doc?.height ?? 9;
  const fitted = useMemo(() => {
    if (view.w <= 0 || view.h <= 0) return { w: 0, h: 0 };
    const k = Math.min(view.w / pw, view.h / ph);
    return { w: pw * k, h: ph * k };
  }, [view, pw, ph]);
  useEffect(() => {
    if (fitted.w <= 0) return;
    const b = backingSize(pw, ph, fitted.w, fitted.h, PixelRatio.get());
    size.value = b;
    ctlRef.current?.setSize(b.W, b.H);
  }, [fitted, pw, ph, size]);

  return (
    <View style={{ flex: 1, backgroundColor: '#000', direction: 'ltr' }} onLayout={onLayout}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        {fitted.w > 0 && (
          <View style={{ width: fitted.w, height: fitted.h }}>
            <Canvas style={{ flex: 1 }}>
              <PreviewScene image={image} redraw={redraw} w={fitted.w} h={fitted.h} />
            </Canvas>
          </View>
        )}
      </View>
      {overlay?.({ safe: safe.on, reason: safe.reason })}
    </View>
  );
}

interface SceneProps {
  image: SharedValue<SkImage | null>;
  redraw: SharedValue<number>;
  w: number;
  h: number;
}

/**
 * The canvas scene, memoised (MA76 rule 4): the composite image (one per canvas size) and an
 * off-canvas 1 px rect whose height is the `redraw` toggle, the value the mapper reads so the view
 * redraws the updated texture without a new image (MA76 rule 2).
 */
const PreviewScene = memo(function PreviewScene({ image, redraw, w, h }: SceneProps) {
  return (
    <>
      <SkiaImage image={image} x={0} y={0} width={w} height={h} fit="fill" />
      <Rect x={-4} y={-4} width={1} height={redraw} color="black" />
    </>
  );
});
