'worklet';
/**
 * The per-frame body of `<StudioPreview>` on the Reanimated UI runtime (ticket MA62 decisions 0, 1,
 * 2), kept pure so jest runs it with fakes:
 *
 * 1. `pumpFrame` (S1) issues seeks / steps and copies each slot's newest decoded frame into its GPU
 *    texture (`gpuFrameSink`, one texture and ONE `SkImage` per slot, MA76);
 * 2. when something changed (a new decoded frame, the extrapolated time crossed a project frame,
 *    the document, the safe-mode flag or the canvas size), the compositor (S2 + S3) draws the
 *    layers into ONE offscreen surface per canvas size, flushed; the canvas shows that surface's
 *    `asImage()` (one image, made with the surface), and the caller bumps a numeric redraw shared
 *    value the scene reads (MA76 rule 2: never a new image or picture per frame);
 * 3. the layers are re-planned with the copied resolver (`orderedVideoClips` + `buildLayersAtTime`
 *    = the web's `buildGLLayer`, decision 2) only when the time crossed a project frame, the
 *    document or the slot images changed; a new decoded frame into the same texture redraws the
 *    same layers.
 *
 * Allocation: the steady-state frame (paused, nothing new) allocates and draws nothing. A frame
 * with a new decoded picture and an unchanged project frame allocates nothing either (the chains
 * reuse their shaders, `compositor.ts`). A crossed project frame re-plans: the copied resolver
 * returns fresh layer objects (the same work the web does per frame) and a keyframed or
 * transitioning stage is remade (S2's rule). No logging anywhere in this file.
 */
import type { SkImage, SkSurface } from 'react-native-skia';
import { buildLayersAtTime, orderedVideoClips } from '../../compositor/buildLayers';
import type { StudioTrack } from '../../studioTypes';
import { createPumpState, pumpFrame, type PumpState } from '../player/framePump';
import type { GpuFrameSink } from '../player/gpuFrameSink';
import type { ClockControl, SlotControl } from '../player/slotControl';
import { SLOT_COUNT, type PreviewPlayer } from '../player/types';
import type { Compositor, FrameLayer, SkiaApi } from './compositor/compositor';
import type { CompLayer } from './compositor/uniforms';
import { captionAlphaAt, captionIndexAt, type CaptionTrack } from './text/captionTimeline';

/** What the JS side publishes for the frame loop (written on change, read in place). */
export interface FrameScene {
  /** Bumped on every publish (the loop re-plans when it changes). */
  seq: number;
  tracks: readonly StudioTrack[];
  projectW: number;
  projectH: number;
  fps: number;
  /** clip id -> pool slot (the video clips that have a decoding slot). */
  slotOf: Record<string, number>;
  /** clip id -> title raster image (`titleRasters.ts`). */
  titleOf: Record<string, SkImage>;
  /** LUT keys the compositor has loaded (`buildLayersAtTime` asks `hasLut`). */
  luts: readonly string[];
  /** Safe mode: only the top-most visible video clip, effects off, titles on. */
  safe: boolean;
  /** The caption preview's recorded segments (`captionTimeline.ts`), drawn above everything. */
  captions: CaptionTrack | null;
}

export interface FrameState {
  pump: PumpState;
  /** The backing size the scene is drawn at. */
  W: number;
  H: number;
  /** The last drawn: scene seq, pump redraw counter, project frame index, image generation. */
  drawnSeq: number;
  drawnRedraw: number;
  drawnFrame: number;
  drawnImageGen: number;
  drawnW: number;
  /** Frames drawn (the fps readout's counter). */
  drawn: number;
  /** The surface the composite is drawn into, its size, and the one image the canvas shows. */
  surface: SkSurface | null;
  surfaceW: number;
  surfaceH: number;
  image: SkImage | null;
  /** The compositor's frame layers, kept between frames. */
  layers: FrameLayer[];
  /** The slot controls, gathered in place each frame (no array per frame). */
  controls: SlotControl[];
}

export function createFrameState(): FrameState {
  return {
    pump: createPumpState(),
    W: 0,
    H: 0,
    drawnSeq: -1,
    drawnRedraw: -1,
    drawnFrame: -1,
    drawnImageGen: -1,
    drawnW: -1,
    drawn: 0,
    surface: null,
    surfaceW: 0,
    surfaceH: 0,
    image: null,
    layers: [],
    controls: [],
  };
}

/** `buildLayersAtTime` only asks the compositor `hasLut(key)`. */
const lutOracle = (keys: readonly string[]) => ({
  hasLut: (k: string) => {
    for (let i = 0; i < keys.length; i += 1) if (keys[i] === k) return true;
    return false;
  },
});

/** Strips what safe mode turns off (decision 11): colour stages, blend modes, chroma key. */
function simplify(l: CompLayer): CompLayer {
  return {
    slot: l.slot,
    srcW: l.srcW,
    srcH: l.srcH,
    transform: l.transform,
    crop: l.crop,
    opacity: l.opacity,
    solid: l.solid,
    wipe: l.wipe,
    imageKey: l.imageKey,
  };
}

/**
 * The layers at timeline time `t` with their sources. Video clips without a slot image this frame
 * (loading, failed) are skipped, as on the web (`clipSlots.has` + `slotTex.get`).
 */
export function planFrame(scene: FrameScene, images: readonly (SkImage | null)[], t: number, W: number, H: number): FrameLayer[] {
  let active = orderedVideoClips(scene.tracks as StudioTrack[], t);
  const sources = new Map<string, { slot: number; srcW: number; srcH: number; imageKey?: string }>();
  const src = new Map<string, SkImage>();
  if (scene.safe) {
    // Single slot: the top-most visible VIDEO clip, plus every title (titles stay on).
    let top = -1;
    for (let i = active.length - 1; i >= 0; i -= 1) {
      if (!active[i]!.clip.title && scene.slotOf[active[i]!.clip.id] !== undefined) {
        top = i;
        break;
      }
    }
    active = active.filter((a, i) => i === top || !!a.clip.title);
  }
  for (const a of active) {
    const title = scene.titleOf[a.clip.id];
    if (a.clip.title) {
      if (!title) continue;
      sources.set(a.clip.id, { slot: -1, srcW: title.width(), srcH: title.height(), imageKey: a.clip.id });
      src.set(a.clip.id, title);
      continue;
    }
    const slot = scene.slotOf[a.clip.id];
    if (slot === undefined) continue;
    const img = images[slot];
    if (!img) continue;
    sources.set(a.clip.id, { slot, srcW: img.width(), srcH: img.height() });
    src.set(a.clip.id, img);
  }
  const layers = buildLayersAtTime(
    active,
    scene.tracks as StudioTrack[],
    t,
    sources,
    lutOracle(scene.luts) as never,
    scene.projectW,
    scene.projectH,
  ) as CompLayer[];
  // `buildLayersAtTime` emits each clip's layer, then its dip layer (if any), in clip order.
  const out: FrameLayer[] = [];
  let clipIdx = 0;
  const drawn = active.filter((a) => sources.has(a.clip.id));
  for (const l0 of layers) {
    const l = scene.safe ? simplify(l0) : l0;
    if (l.solid) {
      const owner = drawn[clipIdx - 1];
      out.push({ key: `${owner ? owner.clip.id : 'x'}:dip`, layer: l, source: { kind: 'solid' } });
      continue;
    }
    const a = drawn[clipIdx]!;
    clipIdx += 1;
    // The web's GL layer is in project space (backing size W x H here): same aspect, so the
    // layer's quad maths are unchanged; only the solid's size follows the backing size.
    out.push({ key: a.clip.id, layer: l, source: { kind: 'image', image: src.get(a.clip.id)! } });
  }
  // Captions: one full-canvas layer above the video, the segment's image at its fade opacity.
  if (scene.captions) {
    const i = captionIndexAt(scene.captions, t);
    if (i >= 0) {
      const alpha = captionAlphaAt(scene.captions, i, t);
      if (alpha > 0) {
        out.push({
          key: 'captions',
          layer: { slot: -1, srcW: W, srcH: H, opacity: alpha, imageKey: 'captions' },
          source: { kind: 'image', image: scene.captions.images[i]! },
        });
      }
    }
  }
  return out;
}

export interface FrameDeps {
  api: SkiaApi;
  compositor: Compositor;
  sink: GpuFrameSink;
}

/**
 * Makes the surface (and its one image) for the current backing size when it changed; the old pair
 * is retired through the compositor (the canvas may still show the old image this frame). Returns
 * true when the image object changed (the caller publishes it once).
 */
export function ensureSurface(st: FrameState, deps: FrameDeps): boolean {
  if (st.surface && st.surfaceW === st.W && st.surfaceH === st.H) return false;
  if (st.image) deps.compositor.retire(st.image);
  if (st.surface) deps.compositor.retire(st.surface);
  st.image = null;
  st.surface = null;
  if (st.W <= 0 || st.H <= 0) return true;
  const surface = deps.api.Surface.MakeOffscreen(st.W, st.H);
  if (!surface) return true;
  st.surface = surface;
  st.surfaceW = st.W;
  st.surfaceH = st.H;
  st.image = surface.asImage();
  st.drawnW = -1; // force a draw into the new surface
  return true;
}

/**
 * One UI-runtime frame. Returns true when the composite was redrawn (the caller bumps the redraw
 * shared value). `ensureSurface` must have run for the current size.
 */
export function previewFrame(
  st: FrameState,
  deps: FrameDeps,
  scene: FrameScene,
  controls: readonly SlotControl[],
  players: readonly (PreviewPlayer | null)[],
  clock: ClockControl,
  nowMs: number,
): boolean {
  pumpFrame(st.pump, controls, players, clock, deps.sink, nowMs);
  deps.sink.endFrame();
  const surface = st.surface;
  const W = st.W;
  const H = st.H;
  if (!surface || W <= 0 || H <= 0) {
    deps.compositor.endFrame();
    return false;
  }
  const fps = scene.fps > 0 ? scene.fps : 30;
  const frameIdx = Math.floor(st.pump.t * fps + 1e-6);
  const imageGen = deps.sink.imageGen();
  const replan =
    scene.seq !== st.drawnSeq || frameIdx !== st.drawnFrame || imageGen !== st.drawnImageGen || W !== st.drawnW;
  if (!replan && st.pump.redraw === st.drawnRedraw) {
    deps.compositor.endFrame();
    return false;
  }
  if (replan) st.layers = planFrame(scene, deps.sink.images as (SkImage | null)[], st.pump.t, W, H);
  st.drawnSeq = scene.seq;
  st.drawnRedraw = st.pump.redraw;
  st.drawnFrame = frameIdx;
  st.drawnImageGen = imageGen;
  st.drawnW = W;
  deps.compositor.draw(surface.getCanvas(), st.layers, W, H);
  surface.flush();
  st.drawn += 1;
  deps.compositor.endFrame();
  return true;
}

/** Releases everything the loop owns (unmount): the surface, its image, the sink's textures. */
export function disposeFrame(st: FrameState, deps: FrameDeps): void {
  for (const o of [st.image, st.surface]) {
    try {
      o?.dispose();
    } catch {
      // already disposed
    }
  }
  st.image = null;
  st.surface = null;
  deps.sink.dispose();
  deps.compositor.dispose();
  st.layers = [];
}

export { SLOT_COUNT };
