/**
 * The per-frame half of the Darkroom preview's decode path (ticket MA62 decision 0), written to run
 * inside the preview's `useFrameCallback` worklet on the Reanimated UI runtime, never on the JS
 * thread (MA59: the JS-thread loop crashes the S25 in 13–33 s).
 *
 * Every call does, per slot, only what has to happen on the frame:
 * - extrapolate the timeline time from the clock the JS side re-anchors every ~100 ms;
 * - issue the seek the JS side requested (one in flight, newest wins; a newer request waits for the
 *   landing or `SCRUB_WAIT_MS`), and the **landing re-seek** of a paused seek: the first frame after
 *   an exact seek is often 18–20 frames past the target while `currentTime` reads the target
 *   (Android `MediaPlayer`, MA59), so a second identical seek goes out when it arrives, and that
 *   first frame is not shown unless 250 ms have passed (until then the last good frame stays up);
 * - start / pause play-mode slots on the frame their clip begins / ends (pre-roll lands on time);
 * - step frame-stepped slots (`speedPolicy.ts`: no player rate in react-native-webgpu 0.22.0);
 * - pull `copyLatestFrame()` and hand it to the `FrameSink` (the GPU copy), which releases it.
 *
 * No allocation: the state is a set of fixed-length number arrays created once
 * (`createPumpState`), the inputs are read in place, outputs are written into the state; the app's
 * frame callback mirrors the few output numbers into numeric shared values. Pure apart from the
 * injected players and sink, so jest drives it with fake players and a fake clock.
 */
import {
  KIND_AUDIO,
  KIND_IDLE,
  KIND_VIDEO,
  MODE_PLAY,
  MODE_STEP,
  type ClockControl,
  type SlotControl,
} from './slotControl';
import { playbackTarget, shouldStep } from './speedPolicy';
import { SLOT_COUNT, type PreviewFrame, type PreviewPlayer } from './types';

/** How long a newer scrub target, or the landing re-seek's frame, is waited for (ms). */
export const SCRUB_WAIT_MS = 250;

/**
 * Copies one decoded frame into the slot's texture and releases it, ALWAYS (also when the copy
 * throws: a held frame blocks the decoder's 3-image queue). Returns false on a failure.
 */
export interface FrameSink {
  copy(slot: number, frame: PreviewFrame, rotation: number): boolean;
}

/** Seek phases per slot. */
const IDLE = 0;
const AWAIT_FIRST = 1;
const AWAIT_RESEEK = 2;

export interface PumpState {
  // clock
  clockSeq: number;
  anchorT: number;
  anchorMs: number;
  /** Timeline seconds this frame (output). */
  t: number;
  /** Bumped when any slot copied a frame (output: the canvas's redraw nudge). */
  redraw: number;
  // per slot
  gen: number[];
  issuedSeq: number[];
  phase: number[];
  exact: number[];
  seekTo: number[];
  seekAtMs: number[];
  reseekAtMs: number[];
  stepTarget: number[];
  stepAtMs: number[];
  stepInFlight: number[];
  /** Outputs read by the JS timer: copied frames, landed seek seq, seek latency (ms). */
  frames: number[];
  landedSeq: number[];
  latencyMs: number[];
  /** Frames released without a copy (overshoot candidates) and sink failures: diagnostics. */
  skipped: number[];
  copyErrors: number[];
}

const filled = (v: number): number[] => {
  'worklet';
  const a: number[] = [];
  for (let i = 0; i < SLOT_COUNT; i += 1) a.push(v);
  return a;
};

export function createPumpState(): PumpState {
  'worklet';
  return {
    clockSeq: -1,
    anchorT: 0,
    anchorMs: 0,
    t: 0,
    redraw: 0,
    gen: filled(-1),
    issuedSeq: filled(0),
    phase: filled(IDLE),
    exact: filled(0),
    seekTo: filled(0),
    seekAtMs: filled(0),
    reseekAtMs: filled(0),
    stepTarget: filled(NaN),
    stepAtMs: filled(-1e9),
    stepInFlight: filled(0),
    frames: filled(0),
    landedSeq: filled(0),
    latencyMs: filled(0),
    skipped: filled(0),
    copyErrors: filled(0),
  };
}

function land(st: PumpState, i: number, nowMs: number): void {
  'worklet';
  st.phase[i] = IDLE;
  st.landedSeq[i] = st.issuedSeq[i]!;
  st.latencyMs[i] = nowMs - st.seekAtMs[i]!;
}

/**
 * One frame. `controls` / `players` / `clock` are what the JS side last published (read in place);
 * `nowMs` is the frame timestamp.
 */
export function pumpFrame(
  st: PumpState,
  controls: readonly SlotControl[],
  players: readonly (PreviewPlayer | null)[],
  clock: ClockControl,
  sink: FrameSink,
  nowMs: number,
): void {
  'worklet';
  if (clock.seq !== st.clockSeq) {
    st.clockSeq = clock.seq;
    st.anchorT = clock.t0;
    st.anchorMs = nowMs;
  }
  const playing = clock.playing === 1;
  const t = playing ? st.anchorT + (nowMs - st.anchorMs) / 1000 : st.anchorT;
  st.t = t;
  let copied = false;

  for (let i = 0; i < SLOT_COUNT; i += 1) {
    const c = controls[i];
    const p = players[i];
    if (!c || !p || c.kind === KIND_IDLE) continue;
    if (c.gen !== st.gen[i]) {
      // A new player (or a new binding of it): forget the previous one's in-flight work.
      st.gen[i] = c.gen;
      st.phase[i] = IDLE;
      st.stepTarget[i] = NaN;
      st.stepInFlight[i] = 0;
    }

    // 1. Seek requests: one in flight, the newest waits for the landing (or SCRUB_WAIT_MS).
    if (c.seekSeq !== st.issuedSeq[i]) {
      const inFlight = st.phase[i] !== IDLE;
      if (!inFlight || nowMs - st.seekAtMs[i]! >= SCRUB_WAIT_MS) {
        p.currentTime = c.seekTo;
        st.issuedSeq[i] = c.seekSeq;
        st.seekTo[i] = c.seekTo;
        st.seekAtMs[i] = nowMs;
        st.exact[i] = c.seekExact;
        st.stepTarget[i] = NaN;
        st.stepInFlight[i] = 0;
        if (c.kind === KIND_AUDIO) {
          // No frames to wait for: an audio-only player has landed as far as the pump can tell.
          st.landedSeq[i] = c.seekSeq;
          st.latencyMs[i] = 0;
        } else {
          st.phase[i] = AWAIT_FIRST;
        }
      }
    }
    // A landing re-seek whose frame never comes is not waited on forever.
    if (st.phase[i] === AWAIT_RESEEK && nowMs - st.reseekAtMs[i]! >= SCRUB_WAIT_MS) land(st, i, nowMs);

    // 2. Run / step. Play mode: the player runs only inside its clip, while the timeline plays.
    if (c.mode === MODE_PLAY) {
      const run = playing && t >= c.startAtT && t < c.stopAtT;
      if (run && p.paused) p.play();
      else if (!run && !p.paused) p.pause();
    } else {
      if (!p.paused) p.pause();
      if (
        c.mode === MODE_STEP &&
        playing &&
        st.phase[i] === IDLE &&
        t >= c.startAtT &&
        t < c.stopAtT
      ) {
        const target = playbackTarget(c, t);
        if (
          shouldStep(
            target,
            st.stepTarget[i]!,
            st.stepAtMs[i]!,
            st.stepInFlight[i] === 1,
            nowMs,
            clock.frameMs,
            c.stepMinDelta,
          )
        ) {
          p.currentTime = target;
          st.stepTarget[i] = target;
          st.stepAtMs[i] = nowMs;
          st.stepInFlight[i] = 1;
        }
      }
    }

    // 3. The decoded frame, if a new one is ready.
    const frame = p.copyLatestFrame();
    if (!frame) continue;
    if (c.kind !== KIND_VIDEO) {
      frame.release();
      continue;
    }
    if (st.phase[i] === AWAIT_FIRST && st.exact[i] === 1) {
      // MA59's paused-seek overshoot: seek again to the same target on landing.
      p.currentTime = st.seekTo[i]!;
      st.phase[i] = AWAIT_RESEEK;
      st.reseekAtMs[i] = nowMs;
      if (nowMs - st.seekAtMs[i]! < SCRUB_WAIT_MS) {
        frame.release();
        st.skipped[i] = st.skipped[i]! + 1;
        continue;
      }
    } else if (st.phase[i] !== IDLE) {
      land(st, i, nowMs);
    }
    st.stepInFlight[i] = 0;
    if (sink.copy(i, frame, p.rotation)) {
      st.frames[i] = st.frames[i]! + 1;
      copied = true;
    } else {
      st.copyErrors[i] = st.copyErrors[i]! + 1;
    }
  }
  if (copied) st.redraw = st.redraw + 1;
}
