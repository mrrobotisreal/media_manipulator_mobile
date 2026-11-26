/**
 * The JS-thread half of `<StudioPreview>` (ticket MA62 decisions 1, 11, 12), plain TypeScript over
 * injected seams so jest runs it with fake players and a fake UI bridge:
 *
 * - owns the S1 `PreviewDriver` (pool, audio-led clock, seek-only drift, volumes) on its ~100 ms
 *   timer (`tick`), and exposes the controller the editor's transport calls: `play / pause /
 *   seek(t) / isPlaying` (decision 1);
 * - publishes the scene the UI-runtime frame loop draws (`FrameScene`: tracks, clip -> slot, title
 *   images, caption segments, safe flag) only when it changes: a document edit, a slot change, a
 *   title or caption re-raster, a safe-mode switch; never per frame;
 * - reads the loop's counters back once a second (`sample`) for the fps readout, safe mode's
 *   low-fps rule and the 60 s perf aggregate. Nothing here runs per frame.
 *
 * Safe mode (decision 11): the pool is limited to the top-most visible video clip (`safeTracks`),
 * the scene drops effects (`FrameScene.safe`), titles stay. `studio_safe_mode_entered` is sent
 * once per reason per session.
 */
import type { StudioPerfSampleProps } from '@/analytics/events';
import { clipEnd, resolveActiveClips } from '../../previewEngine';
import type { StudioCaptionCue, StudioCaptionStyle, StudioTrack } from '../../studioTypes';
import { PreviewDriver, type DriverDoc } from '../player/PreviewDriver';
import type { VideoPoolDeps } from '../player/VideoPool';
import { SLOT_COUNT } from '../player/types';
import type { FrameScene } from './previewFrame';
import { PerfAggregator, type DeviceClass } from './perf';
import { initialSafeMode, onCapability, onFps, onToggle, type SafeModeReason, type SafeModeState } from './safeMode';
import type { CaptionTrack } from './text/captionTimeline';

/** The editor's document as the preview needs it (a subset of `StudioProject`). */
export interface PreviewDoc extends DriverDoc {
  width: number;
  height: number;
  captions?: readonly StudioCaptionCue[];
  captionStyle?: StudioCaptionStyle | null;
  captionsEnabled?: boolean;
}

/** What the frame loop exposes back (numbers read on the 1 s sample). */
export interface LoopCounters {
  /** Composites drawn so far. */
  drawn(): number;
  /** Frames copied per slot so far. */
  frames(slot: number): number;
}

/** The text side (titles and captions), injected so jest can pass fakes. */
export interface TextLayers {
  /** Re-rasters titles near `t`; returns clip id -> image when something changed, else null. */
  titles(doc: PreviewDoc, W: number, H: number, t: number): FrameScene['titleOf'] | null;
  /** Re-records captions when they changed; returns the new track (null = none), or undefined. */
  captions(doc: PreviewDoc, W: number, H: number): CaptionTrack | null | undefined;
}

export interface ControllerDeps {
  pool: VideoPoolDeps;
  publishScene(scene: FrameScene): void;
  counters: LoopCounters;
  text: TextLayers;
  gpu(): 'ok' | 'unavailable' | null;
  trackSafeMode(reason: SafeModeReason): void;
  sendPerf(props: StudioPerfSampleProps): void;
  heapBytes(): number | null;
  deviceClass: DeviceClass;
  /** Called when the safe flag changes (the dev screen's chip). */
  onSafeChange?: (on: boolean, reason: SafeModeReason | null) => void;
}

/** Safe mode's single slot: only the top-most visible video clip at t keeps its media. */
export function safeTracks(tracks: readonly StudioTrack[], t: number): StudioTrack[] {
  const hidden = new Set(tracks.filter((tr) => tr.kind === 'video' && tr.hidden).map((tr) => tr.id));
  let top: { trackId: string; clipId: string; index: number } | null = null;
  for (const a of resolveActiveClips(tracks as StudioTrack[], t)) {
    if (a.trackKind !== 'video' || hidden.has(a.trackId) || a.clip.title) continue;
    if (!top || a.trackIndex > top.index) top = { trackId: a.trackId, clipId: a.clip.id, index: a.trackIndex };
  }
  return tracks.map((tr) => ({
    ...tr,
    clips: tr.clips.filter((c) => !!c.title || (top !== null && c.id === top.clipId)),
  }));
}

export class PreviewController {
  readonly driver: PreviewDriver;
  private doc: PreviewDoc;
  private readonly deps: ControllerDeps;
  private safe: SafeModeState = initialSafeMode();
  private readonly perf: PerfAggregator;
  private scene: FrameScene;
  private size = { W: 0, H: 0 };
  private slotKey = '';
  /** Safe mode's single clip (the top-most visible video clip at the playhead), '' = none. */
  private safeClip = '';
  private last = { drawn: 0, atMs: 0, stuck: 0, resync: 0, landed: [0, 0, 0, 0] as number[] };
  private playStartedMs = 0;
  /** The last measured composited fps (the dev readout). */
  fps = 0;

  constructor(deps: ControllerDeps, doc: PreviewDoc, t = 0) {
    this.deps = deps;
    this.doc = doc;
    this.driver = new PreviewDriver(deps.pool, this.driverDoc(), t);
    this.perf = new PerfAggregator({
      send: deps.sendPerf,
      heapBytes: deps.heapBytes,
      deviceClass: deps.deviceClass,
      gpuUnavailable: () => deps.gpu() === 'unavailable',
    });
    this.scene = {
      seq: 0,
      tracks: doc.tracks,
      projectW: doc.width,
      projectH: doc.height,
      fps: doc.fps,
      slotOf: {},
      titleOf: {},
      luts: [],
      safe: false,
      captions: null,
    };
    this.applySafe(onCapability(this.safe, deps.gpu()));
  }

  // --- the controller (decision 1) ----------------------------------------------------------
  get isPlaying(): boolean {
    return this.driver.isPlaying;
  }
  get t(): number {
    return this.driver.t;
  }
  play(nowMs: number): void {
    if (!this.driver.isPlaying) this.playStartedMs = nowMs;
    this.driver.play(nowMs);
    this.last.drawn = this.deps.counters.drawn();
    this.last.atMs = nowMs;
  }
  pause(nowMs: number): void {
    this.driver.pause(nowMs);
  }
  seek(t: number, nowMs: number): void {
    this.followSafeClip();
    this.driver.seek(t, nowMs);
    this.followSafeClip();
    this.refreshText(true);
  }

  get safeMode(): boolean {
    return this.safe.on;
  }

  setSafeMode(on: boolean): void {
    this.applySafe(onToggle(this.safe, on, this.deps.gpu()));
  }

  /** The GPU capability answer arrived after mount. */
  capabilityKnown(): void {
    this.applySafe(onCapability(this.safe, this.deps.gpu()));
  }

  setDoc(doc: PreviewDoc): void {
    this.doc = doc;
    this.driver.setDoc(this.driverDoc());
    this.scene = { ...this.scene, tracks: doc.tracks, projectW: doc.width, projectH: doc.height, fps: doc.fps };
    this.refreshText(true);
    this.publish();
  }

  /** The canvas's backing size (px). */
  setSize(W: number, H: number): void {
    if (W === this.size.W && H === this.size.H) return;
    this.size = { W, H };
    this.refreshText(true);
    this.publish();
  }

  // --- timers --------------------------------------------------------------------------------
  /** The ~100 ms timer: the S1 driver, then the scene when the slots changed. */
  tick(nowMs: number): void {
    this.followSafeClip();
    this.driver.tick(nowMs);
    const slotOf = this.slotMap();
    const key = JSON.stringify(slotOf);
    if (key !== this.slotKey) {
      this.slotKey = key;
      this.scene = { ...this.scene, slotOf };
      this.publish();
    }
    this.refreshText(false);
  }

  /** The ~1 s timer: fps, safe mode's low-fps rule, the perf aggregate. */
  sample(nowMs: number): void {
    const drawn = this.deps.counters.drawn();
    const dt = nowMs - this.last.atMs;
    const playing = this.driver.isPlaying;
    this.fps = dt > 0 ? ((drawn - this.last.drawn) * 1000) / dt : 0;
    const expected = dt > 0 ? (dt / 1000) * (this.doc.fps > 0 ? this.doc.fps : 30) : 0;
    const dropped = expected > 0 ? Math.max(0, 1 - (drawn - this.last.drawn) / expected) : 0;
    const latencies: number[] = [];
    let resync = 0;
    let slots = 0;
    for (const s of this.driver.pool.slots) {
      const b = this.driver.sync[s.index]!;
      if (b.landedSeq !== this.last.landed[s.index]) {
        this.last.landed[s.index] = b.landedSeq;
        latencies.push(b.latencyMs);
      }
      resync += b.corrections;
      if (s.player && s.kind === 'video' && !s.failed && s.role === 'active') slots += 1;
    }
    const stuck = this.driver.pool.slots.filter((s) => s.failed).length;
    const newStuck = Math.max(0, stuck - this.last.stuck);
    this.last.stuck = stuck;
    const newResync = Math.max(0, resync - this.last.resync);
    this.last.resync = resync;
    // The first second after play() is warm-up (pre-roll, landing seeks): not a measurement.
    const warm = playing && nowMs - this.playStartedMs >= 1000 && this.last.atMs >= this.playStartedMs;
    this.applySafe(onFps(this.safe, this.fps, warm, nowMs));
    this.perf.sample({
      nowMs,
      playing: warm,
      fps: this.fps,
      droppedRatio: dropped,
      slots,
      safeMode: this.safe.on,
      seekLatenciesMs: latencies,
      resyncSeeks: newResync,
      stuckRecoveries: newStuck,
    });
    this.last.drawn = drawn;
    this.last.atMs = nowMs;
  }

  /** Background or unmount: send the partial window. */
  flushPerf(): void {
    this.perf.flush();
  }

  dispose(): void {
    this.perf.flush();
    this.driver.dispose();
  }

  // -------------------------------------------------------------------------------------------
  /** In safe mode the single slot follows the playhead: a new top clip gives the pool a new doc. */
  private followSafeClip(): void {
    if (!this.safe.on) return;
    const t = this.driver.t;
    const tracks = safeTracks(this.doc.tracks, t);
    let id = '';
    for (const tr of tracks) for (const c of tr.clips) if (!c.title) id = c.id;
    if (id === this.safeClip) return;
    this.safeClip = id;
    this.driver.setDoc({ tracks, audio: this.doc.audio, fps: this.doc.fps });
  }

  private driverDoc(): DriverDoc {
    return {
      tracks: this.safe.on ? safeTracks(this.doc.tracks, this.driver ? this.driver.t : 0) : this.doc.tracks,
      audio: this.doc.audio,
      fps: this.doc.fps,
    };
  }

  private slotMap(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const s of this.driver.pool.slots) {
      // Active slots only: a retained or pre-rolled clip is not at the playhead.
      if (s.clipId && s.player && s.kind === 'video' && !s.failed && s.role === 'active') out[s.clipId] = s.index;
    }
    return out;
  }

  private refreshText(force: boolean): void {
    const { W, H } = this.size;
    if (W <= 0 || H <= 0) return;
    const titles = this.deps.text.titles(this.doc, W, H, this.driver.t);
    const captions = this.deps.text.captions(this.doc, W, H);
    if (titles || captions !== undefined) {
      this.scene = {
        ...this.scene,
        titleOf: titles ?? this.scene.titleOf,
        captions: captions !== undefined ? captions : this.scene.captions,
      };
      this.publish();
    } else if (force) this.publish();
  }

  private applySafe(step: { state: SafeModeState; report: SafeModeReason | null }): void {
    const was = this.safe.on;
    this.safe = step.state;
    if (step.report) {
      try {
        this.deps.trackSafeMode(step.report);
      } catch {
        // analytics never breaks the preview
      }
    }
    if (was !== this.safe.on) {
      // The pool follows the single-slot document on its next tick; the scene drops effects now.
      this.safeClip = '';
      if (this.driver) this.driver.setDoc(this.driverDoc());
      this.scene = { ...this.scene, safe: this.safe.on };
      this.publish();
      this.deps.onSafeChange?.(this.safe.on, this.safe.reason);
    }
  }

  private publish(): void {
    this.scene = { ...this.scene, seq: this.scene.seq + 1 };
    this.deps.publishScene(this.scene);
  }
}

/** The end of the timeline (s), for the scrub bar. */
export function previewDuration(tracks: readonly StudioTrack[]): number {
  let end = 0;
  for (const tr of tracks) for (const c of tr.clips) end = Math.max(end, clipEnd(c));
  return end;
}

export { SLOT_COUNT };
