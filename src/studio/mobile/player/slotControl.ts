/**
 * The contract between the JS side of the preview (the pool, clock and volumes, run on a ~100 ms
 * timer) and the per-frame pump on the UI runtime (`framePump.ts`). Decision 0 of MA62:
 *
 * - JS -> UI: one `SlotControl` object per slot and one `ClockControl`, written only when they
 *   change (an assignment, a seek, play / pause, the clock re-anchoring on a tick), never per frame.
 *   The pump reads their fields in place; nothing is copied per frame.
 * - UI -> JS: plain numbers per slot (`frames`, `landedSeq`, `latencyMs`), read by the JS timer.
 *
 * Everything is a number so the pump never allocates and the objects serialise cheaply.
 */

export const KIND_IDLE = 0;
export const KIND_VIDEO = 1;
/** An audio-only proxy: decoded for sound, never copied to a texture, never times out on frames. */
export const KIND_AUDIO = 2;

/** `speedPolicy.ts` modes as numbers. */
export const MODE_PLAY = 0;
export const MODE_STEP = 1;
export const MODE_HOLD = 2;

export interface SlotControl {
  /** Bumped whenever the slot's player changes (load, release): the pump resets its slot state. */
  gen: number;
  kind: number;
  mode: number;
  /** Player media time at timeline time t: clamp(a + b * t, lo, hi) (`speedPolicy.ts`). */
  a: number;
  b: number;
  lo: number;
  hi: number;
  /** Timeline window in which a play-mode slot runs (the pump starts / pauses it on time). */
  startAtT: number;
  stopAtT: number;
  /** A seek request: the pump issues it when `seekSeq` changes. */
  seekSeq: number;
  seekTo: number;
  /** 1: a paused (exact) seek, which gets the landing re-seek (MA59: paused seeks overshoot). */
  seekExact: number;
  /** Half a source frame (s): a step seek moving less than this is skipped. */
  stepMinDelta: number;
}

export interface ClockControl {
  /** Bumped on every write: the pump re-anchors its extrapolation on its own clock. */
  seq: number;
  playing: number;
  /** Timeline seconds at the anchor. */
  t0: number;
  /** One project frame (ms): the step cadence. */
  frameMs: number;
}

export const FAR_PAST = -1e9;
export const FAR_FUTURE = 1e9;

export function idleControl(gen = 0): SlotControl {
  return {
    gen,
    kind: KIND_IDLE,
    mode: MODE_PLAY,
    a: 0,
    b: 1,
    lo: 0,
    hi: 0,
    startAtT: FAR_FUTURE,
    stopAtT: FAR_FUTURE,
    seekSeq: 0,
    seekTo: 0,
    seekExact: 0,
    stepMinDelta: 1 / 60,
  };
}

/** Where the JS side publishes to the pump (shared values in the app, plain objects in tests). */
export interface PumpSink {
  setControl(slot: number, control: SlotControl): void;
  /** The players by slot (written when the set changes; the pump keeps them by reference). */
  setPlayers(players: readonly (unknown | null)[]): void;
  setClock(clock: ClockControl): void;
}

/** What the JS side reads back from the pump on its timer. */
export interface PumpFeedback {
  frames(slot: number): number;
  /** The `seekSeq` whose first frame has arrived (the seek landed). */
  landedSeq(slot: number): number;
  /** The pump's last measured seek-to-first-frame latency for the slot (ms), 0 before any. */
  latencyMs(slot: number): number;
}
