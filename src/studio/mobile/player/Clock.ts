/**
 * The Darkroom preview's master clock and drift policy (ticket MA62 decision 4, adapted by
 * decision 0). JS thread, run from the preview's ~100 ms timer; the UI-runtime frame pump
 * extrapolates between ticks from the `ClockControl` this publishes.
 *
 * - **Audio-led:** the master is the player of the top-most audible clip that plays at its own
 *   rate (a play-mode slot, gain > 0, seek landed); its media time, mapped back to timeline time,
 *   advances the playhead through the copied `masterClockStep` (playbackSync.ts: jitter hold, stall
 *   and jump fallback to the display clock). Without one, a monotonic timer.
 * - **Drift:** `react-native-webgpu` 0.22.0's player has no rate, so the web's rate nudge does not
 *   port. Correction is **seek-only** with a **2-frame dead band** (MA59: players started together
 *   hold 1–2 frames over a minute; a tighter band fires often and every seek risks the paused-seek
 *   overshoot). A seek aims ahead by the measured seek latency, never stacks on a seek in flight,
 *   and respects the web's re-seek cooldown and settle time (`MIN_RESEEK_MS`, `SETTLE_MS`). The
 *   master itself is re-seeked only past the web's audio resync bound (`AUDIO_RESYNC_S`), which
 *   pulls it back if a stall left it behind the playhead.
 * - **Scrub:** a paused seek goes to every slot as an exact seek; the pump keeps one in flight,
 *   waits up to 250 ms for its frame (the last good frame stays on screen meanwhile) and re-seeks
 *   on landing (MA59's overshoot). See `framePump.ts`.
 */
import {
  AUDIO_RESYNC_S,
  MAX_SEEK_LATENCY_MS,
  MIN_RESEEK_MS,
  MIN_SEEK_LATENCY_MS,
  SETTLE_MS,
  masterClockStep,
} from '../../playbackSync';

/** The dead band while playing, in project frames (decision 0). */
export const DRIFT_DEAD_BAND_FRAMES = 2;

/**
 * The seek-latency estimate before the first measurement. The web starts at 300 ms
 * (`DEFAULT_SEEK_LATENCY_MS`, network proxies); the phone decodes a cached local proxy, whose
 * first frame after a seek MA59 measured at p95 74–99 ms (S25, N = 1–4), so a 300 ms lead would
 * overshoot every early correction. The measured estimate takes over after the first landing.
 */
export const PHONE_DEFAULT_SEEK_LATENCY_MS = 100;

/**
 * Each tick the playhead closes this fraction of its gap to the master's position (when under the
 * audio resync bound), so it becomes what is heard without a visible jump: the web's audio clock
 * IS the output, the phone's master is a player that may start a frame or two after `play()`.
 */
export const MASTER_SLEW = 0.5;

export interface DriftInput {
  /** The player's media time now. */
  current: number;
  /** Where it should be (`playbackTarget`). */
  target: number;
  /** Media seconds per timeline second (the clip's speed; 1 in play mode). */
  baseRate: number;
  /** Project fps (the dead band is 2 of its frames). */
  fps: number;
  nowMs: number;
  lastSeekAtMs: number | null;
  landedAtMs: number | null;
  seekPending: boolean;
  latencyMs: number;
  /** Media duration when known (seeks stay 50 ms inside it, like the web). */
  maxTime?: number;
  /** The master is only pulled back past `AUDIO_RESYNC_S`. */
  isMaster: boolean;
}

export type DriftAction = { kind: 'hold'; drift: number } | { kind: 'seek'; drift: number; time: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Decide one playing slot's correction this tick. `drift` is in timeline seconds (< 0 = behind). */
export function planDrift(i: DriftInput): DriftAction {
  const base = i.baseRate > 0 ? i.baseRate : 1;
  const drift = (i.current - i.target) / base;
  if (i.seekPending) return { kind: 'hold', drift };
  const band = i.isMaster ? AUDIO_RESYNC_S : DRIFT_DEAD_BAND_FRAMES / (i.fps > 0 ? i.fps : 30);
  if (Math.abs(drift) <= band) return { kind: 'hold', drift };
  const sinceSeek = i.lastSeekAtMs === null ? Infinity : i.nowMs - i.lastSeekAtMs;
  const sinceLanded = i.landedAtMs === null ? Infinity : i.nowMs - i.landedAtMs;
  if (sinceSeek < MIN_RESEEK_MS || sinceLanded < SETTLE_MS) return { kind: 'hold', drift };
  const lead = (clamp(i.latencyMs, MIN_SEEK_LATENCY_MS, MAX_SEEK_LATENCY_MS) / 1000) * base;
  const hi = i.maxTime !== undefined && i.maxTime > 0 ? i.maxTime - 0.05 : Infinity;
  return { kind: 'seek', drift, time: clamp(i.target + lead, 0, hi) };
}

/** A candidate for the master clock (the driver lists the play-mode slots). */
export interface MasterCandidate {
  slot: number;
  /** Higher wins: the top-most audible clip. */
  priority: number;
  /** The slot's current preview gain (0 = inaudible, never the master). */
  gain: number;
  /** Its seek has landed and the player runs. */
  ready: boolean;
}

/** The master slot, or -1 for the monotonic timer. */
export function pickMaster(cs: readonly MasterCandidate[]): number {
  let best = -1;
  let bestP = -Infinity;
  for (const c of cs) {
    if (!c.ready || !(c.gain > 0)) continue;
    if (c.priority > bestP) {
      bestP = c.priority;
      best = c.slot;
    }
  }
  return best;
}

export interface ClockState {
  playing: boolean;
  /** Timeline seconds. */
  t: number;
  /** Master-derived timeline time of the previous tick (null: none / master changed). */
  prevMasterT: number | null;
  masterSlot: number;
  lastTickMs: number | null;
}

export class Clock {
  state: ClockState;

  constructor(
    t = 0,
    /** Timeline end (s): playback stops there. */
    public duration = Infinity,
  ) {
    this.state = { playing: false, t, prevMasterT: null, masterSlot: -1, lastTickMs: null };
  }

  get t(): number {
    return this.state.t;
  }

  get playing(): boolean {
    return this.state.playing;
  }

  play(nowMs: number): void {
    if (this.state.playing) return;
    if (this.state.t >= this.duration) this.state.t = 0;
    this.state = { ...this.state, playing: true, prevMasterT: null, lastTickMs: nowMs };
  }

  pause(): void {
    this.state = { ...this.state, playing: false, prevMasterT: null, lastTickMs: null };
  }

  seek(t: number): void {
    const end = Number.isFinite(this.duration) ? this.duration : Infinity;
    this.state = { ...this.state, t: clamp(t, 0, end), prevMasterT: null };
  }

  /**
   * Advance while playing. `masterT`: the master's media time mapped to timeline time (null when
   * there is no master, its seek is pending, or it just changed: the monotonic timer runs).
   * Returns true when playback reached the end and paused.
   */
  tick(nowMs: number, masterSlot: number, masterT: number | null): boolean {
    const s = this.state;
    if (!s.playing) return false;
    const rafDt = s.lastTickMs === null ? 0 : (nowMs - s.lastTickMs) / 1000;
    const prev = masterSlot === s.masterSlot ? s.prevMasterT : null;
    const mt = masterSlot >= 0 ? masterT : null;
    const step = masterClockStep(prev, mt, rafDt);
    let t = s.t + step.dt;
    // Slew only while the master clock itself is leading (not on a first reading, a stall or a jump).
    const audioLed = prev !== null && mt !== null && step.dt > 0 && Math.abs(step.dt - (mt - prev)) < 1e-9;
    if (audioLed && Math.abs(mt - t) < AUDIO_RESYNC_S) t += (mt - t) * MASTER_SLEW;
    let playing = true;
    if (t >= this.duration) {
      t = this.duration;
      playing = false;
    }
    this.state = { playing, t, prevMasterT: step.audio, masterSlot, lastTickMs: nowMs };
    return !playing;
  }
}
