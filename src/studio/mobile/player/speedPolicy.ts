/**
 * How a clip's slot plays its source on the phone (ticket MA62 decision 3, adapted by decision 0).
 *
 * `react-native-webgpu` 0.22.0's `VideoPlayer` has no playback rate (`types.ts`), so a clip whose
 * speed is not 1 cannot play at that rate. It previews **frame-stepped**: the player stays paused and
 * the UI-runtime frame pump (`framePump.ts`) seeks it to the clip's source position at the project
 * frame cadence, one seek in flight at a time, audio muted. The speed sheet (MA64) says so.
 *
 * Modes:
 * - `play`: speed 1 forward on the proxy, or speed 1 reversed on the server's reversed proxy (which
 *   plays forward, part 17): the player runs at its own rate, audio on.
 * - `step`: any other speed, and a reversed clip whose reversed proxy is not ready yet (the web
 *   holds that one paused and follows the target with exact seeks: the same thing). Muted.
 * - `hold`: a freeze clip (one source frame for its whole length). Muted.
 *
 * The source position is linear in timeline time between clamps, so the pump can compute it on the
 * UI runtime from four numbers (`a + b * t` clamped to `[lo, hi]`) without the copied resolver. The
 * coefficients are derived from, and tested against, the copied `sourceTimeAt` / `reversedProxyTime`
 * (`speed.ts`); they are not a second statement of the speed model.
 */
import { clipSpeed, isFreezeClip, isReversed, sourceTimeAt } from '../../speed';
import type { StudioClip } from '../../studioTypes';

export type SlotMode = 'play' | 'step' | 'hold';

export interface ClipPlayback {
  mode: SlotMode;
  /** Decode the reversed proxy (`proxy-reversed`) instead of the proxy. */
  reversedSource: boolean;
  /** Stepped and held clips are silent (decision 0). */
  muted: boolean;
  /** Player media time at timeline time t: clamp(a + b * t, lo, hi). */
  a: number;
  b: number;
  lo: number;
  hi: number;
}

/**
 * `reverseReady`: the copied `reverseProxyReady(entry)`; `reversedDuration`: the reversed proxy's
 * duration (the asset's `durationSeconds`, which the reversed proxy mirrors).
 */
export function clipPlayback(
  clip: StudioClip,
  reverseReady: boolean,
  reversedDuration: number,
): ClipPlayback {
  if (isFreezeClip(clip)) {
    const at = sourceTimeAt(clip, clip.timelineStart);
    return { mode: 'hold', reversedSource: false, muted: true, a: at, b: 0, lo: at, hi: at };
  }
  const s = clipSpeed(clip);
  const start = clip.timelineStart;
  if (isReversed(clip)) {
    if (reverseReady && reversedDuration > 0) {
      // reversedProxyTime(sourceOut - (t - start) * s, D) = D - sourceOut + (t - start) * s
      const D = reversedDuration;
      return {
        mode: s === 1 ? 'play' : 'step',
        reversedSource: true,
        muted: s !== 1,
        a: D - clip.sourceOut - start * s,
        b: s,
        lo: Math.max(0, D - clip.sourceOut),
        hi: Math.min(D, D - clip.sourceIn),
      };
    }
    // Not built yet: step backwards on the forward proxy (the web's paused poster that follows the
    // target with exact seeks), silent.
    return {
      mode: 'step',
      reversedSource: false,
      muted: true,
      a: clip.sourceOut + start * s,
      b: -s,
      lo: clip.sourceIn,
      hi: clip.sourceOut,
    };
  }
  return {
    mode: s === 1 ? 'play' : 'step',
    reversedSource: false,
    muted: s !== 1,
    a: clip.sourceIn - start * s,
    b: s,
    lo: clip.sourceIn,
    hi: clip.sourceOut,
  };
}

/** The player media time for timeline time `t` (also the pump's per-frame formula). */
export function playbackTarget(p: Pick<ClipPlayback, 'a' | 'b' | 'lo' | 'hi'>, t: number): number {
  'worklet';
  const v = p.a + p.b * t;
  return v < p.lo ? p.lo : v > p.hi ? p.hi : v;
}

/** A step seek that never yields a frame is given up after this long and the next one goes out. */
export const STEP_STUCK_MS = 600;

/**
 * Whether the pump should seek a stepped slot now: one seek in flight (newest target wins, like the
 * web's paused planner), at most one per project frame (`minIntervalMs`), and only when the target
 * moved by at least half a source frame (`minDelta`). `lastTarget` is NaN before the first step.
 * Positional numbers, no object: it runs per frame on the UI runtime and must not allocate.
 */
export function shouldStep(
  target: number,
  lastTarget: number,
  lastAtMs: number,
  inFlight: boolean,
  nowMs: number,
  minIntervalMs: number,
  minDelta: number,
): boolean {
  'worklet';
  const since = nowMs - lastAtMs;
  if (inFlight && since < STEP_STUCK_MS) return false;
  if (since < minIntervalMs) return false;
  if (lastTarget !== lastTarget) return true; // NaN: never stepped
  const d = target - lastTarget;
  return (d < 0 ? -d : d) >= minDelta;
}
