/**
 * The JS-thread half of the Darkroom preview's playback (ticket MA62 decisions 3–5): one `tick()`
 * every ~100 ms (decision 0: the clock, sync check and UI read back on a timer, never per frame)
 * reconciles the `VideoPool`, advances the `Clock`, corrects drift by seeking, sets every player's
 * volume (`AudioVolumes`) and re-anchors the clock the UI-runtime pump extrapolates from.
 * `play()` / `pause()` / `seek(t)` are the controller the editor's transport calls (MA63 mounts
 * `<StudioPreview>`, which owns one driver).
 *
 * Plain TypeScript over the `PlayerFactory`, `PoolMedia`, `PumpSink` and `PumpFeedback` seams, so
 * the jest suite runs it end to end with fake players and the real pump.
 */
import { nextLatencyEstimate } from '../../playbackSync';
import { timelineDuration } from '../../previewEngine';
import type { StudioAudioConfig, StudioTrack } from '../../studioTypes';
import { anySolo } from '../../trackAudibility';
import { applyVolume, slotVolume } from './AudioVolumes';
import { Clock, PHONE_DEFAULT_SEEK_LATENCY_MS, pickMaster, planDrift, type MasterCandidate } from './Clock';
import { MODE_PLAY, type ClockControl } from './slotControl';
import { playbackTarget } from './speedPolicy';
import { SLOT_COUNT } from './types';
import { VideoPool, type VideoPoolDeps } from './VideoPool';

/** The JS timer period (ms). */
export const TICK_MS = 100;

export interface DriverDoc {
  tracks: readonly StudioTrack[];
  audio?: StudioAudioConfig;
  fps: number;
}

export interface SlotSyncBook {
  lastSeekSeq: number;
  lastSeekAtMs: number | null;
  landedSeq: number;
  landedAtMs: number | null;
  latencyMs: number;
  corrections: number;
}

export class PreviewDriver {
  readonly pool: VideoPool;
  readonly clock: Clock;
  readonly sync: SlotSyncBook[];
  private doc: DriverDoc;
  private clockSeq = 0;

  constructor(
    private readonly deps: VideoPoolDeps,
    doc: DriverDoc,
    t = 0,
  ) {
    this.doc = doc;
    this.pool = new VideoPool(deps);
    this.clock = new Clock(t, timelineDuration(doc.tracks as StudioTrack[]));
    this.sync = Array.from({ length: SLOT_COUNT }, () => ({
      lastSeekSeq: 0,
      lastSeekAtMs: null,
      landedSeq: 0,
      landedAtMs: null,
      latencyMs: PHONE_DEFAULT_SEEK_LATENCY_MS,
      corrections: 0,
    }));
    this.publishClock();
  }

  /** The document changed (an edit, an undo): the next tick reconciles to it. */
  setDoc(doc: DriverDoc): void {
    this.doc = doc;
    this.clock.duration = timelineDuration(doc.tracks as StudioTrack[]);
  }

  get t(): number {
    return this.clock.t;
  }

  get isPlaying(): boolean {
    return this.clock.playing;
  }

  play(nowMs: number): void {
    this.clock.play(nowMs);
    this.reconcile(nowMs);
    this.publishClock();
  }

  pause(nowMs: number): void {
    this.clock.pause();
    this.reconcile(nowMs);
    // Paused: every active slot lands exactly on the playhead's frame.
    this.seekAll(nowMs, true);
    this.publishClock();
  }

  /** Scrub / jump. Paused: exact seeks (landing re-seek and 250 ms wait in the pump). */
  seek(t: number, nowMs: number): void {
    this.clock.seek(t);
    this.reconcile(nowMs);
    this.seekAll(nowMs, !this.clock.playing);
    this.publishClock();
  }

  /** The ~100 ms timer. */
  tick(nowMs: number): void {
    this.readFeedback(nowMs);
    if (this.clock.playing) {
      const master = this.masterSlot();
      const s = master >= 0 ? this.pool.slots[master]! : null;
      const masterT = s?.player && s.control.b !== 0 ? (s.player.currentTime - s.control.a) / s.control.b : null;
      this.clock.tick(nowMs, master, masterT);
    }
    this.reconcile(nowMs);
    if (this.clock.playing) this.correctDrift(nowMs);
    this.publishClock();
  }

  dispose(): void {
    this.pool.releaseAll();
  }

  // -------------------------------------------------------------------------

  private reconcile(nowMs: number): void {
    this.pool.update({ tracks: this.doc.tracks, t: this.clock.t, playing: this.clock.playing, nowMs });
    this.stampSeeks(nowMs);
    this.applyVolumes();
  }

  private seekAll(nowMs: number, exact: boolean): void {
    for (const s of this.pool.slots) {
      if (s.role !== 'active' || !s.player || !s.playback) continue;
      const to = playbackTarget(s.control, this.clock.t);
      // The pool's own (re)load seek already aims here: do not queue a duplicate behind it.
      if (this.pool.seekPending(s) && s.control.seekTo === to && s.control.seekExact === (exact ? 1 : 0)) continue;
      this.pool.requestSeek(s, to, exact, nowMs);
    }
    this.stampSeeks(nowMs);
  }

  private stampSeeks(nowMs: number): void {
    for (const s of this.pool.slots) {
      const b = this.sync[s.index]!;
      if (s.control.seekSeq !== b.lastSeekSeq) {
        b.lastSeekSeq = s.control.seekSeq;
        b.lastSeekAtMs = nowMs;
      }
    }
  }

  private readFeedback(nowMs: number): void {
    for (const s of this.pool.slots) {
      const b = this.sync[s.index]!;
      const landed = this.deps.feedback.landedSeq(s.index);
      if (landed !== b.landedSeq) {
        b.landedSeq = landed;
        b.landedAtMs = nowMs;
        const lat = this.deps.feedback.latencyMs(s.index);
        if (lat > 0) b.latencyMs = nextLatencyEstimate(b.latencyMs, lat);
      }
    }
  }

  private gainOf(i: number, soloOn: boolean): number {
    const s = this.pool.slots[i]!;
    return slotVolume(
      {
        clip: s.clip,
        trackId: s.trackId,
        active: s.role === 'active' && !s.failed,
        stalled: !s.playback || s.playback.muted,
      },
      { tracks: this.doc.tracks, audio: this.doc.audio, t: this.clock.t },
      soloOn,
    );
  }

  private applyVolumes(): void {
    const soloOn = anySolo(this.doc.tracks as StudioTrack[]);
    for (const s of this.pool.slots) {
      if (!s.player) continue;
      applyVolume(s.player, this.clock.playing ? this.gainOf(s.index, soloOn) : 0);
    }
  }

  private masterSlot(): number {
    const soloOn = anySolo(this.doc.tracks as StudioTrack[]);
    const cs: MasterCandidate[] = [];
    for (const s of this.pool.slots) {
      if (s.role !== 'active' || !s.player || !s.clip || s.control.mode !== MODE_PLAY) continue;
      const track = this.doc.tracks.find((tr) => tr.id === s.trackId);
      if (!track) continue;
      const priority = track.kind === 'video' ? 1000 + track.index : 500 - track.index;
      cs.push({
        slot: s.index,
        priority,
        gain: this.gainOf(s.index, soloOn),
        ready: !this.pool.seekPending(s) && !s.player.paused,
      });
    }
    return pickMaster(cs);
  }

  private correctDrift(nowMs: number): void {
    const master = this.clock.state.masterSlot;
    for (const s of this.pool.slots) {
      if (s.role !== 'active' || !s.player || s.control.mode !== MODE_PLAY || s.failed) continue;
      const t = this.clock.t;
      if (t < s.control.startAtT || t >= s.control.stopAtT) continue;
      const b = this.sync[s.index]!;
      const plan = planDrift({
        current: s.player.currentTime,
        target: playbackTarget(s.control, t),
        baseRate: s.control.b === 0 ? 1 : Math.abs(s.control.b),
        fps: this.doc.fps,
        nowMs,
        lastSeekAtMs: b.lastSeekAtMs,
        landedAtMs: b.landedAtMs,
        seekPending: this.pool.seekPending(s),
        latencyMs: b.latencyMs,
        maxTime: s.player.duration > 0 ? s.player.duration : undefined,
        isMaster: s.index === master,
      });
      if (plan.kind === 'seek') {
        this.pool.requestSeek(s, plan.time, false, nowMs);
        b.corrections += 1;
      }
    }
    this.stampSeeks(nowMs);
  }

  private publishClock(): void {
    this.clockSeq += 1;
    const c: ClockControl = {
      seq: this.clockSeq,
      playing: this.clock.playing ? 1 : 0,
      t0: this.clock.t,
      frameMs: 1000 / (this.doc.fps > 0 ? this.doc.fps : 30),
    };
    this.deps.sink.setClock(c);
  }
}
