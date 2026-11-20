// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/qualityGovernor.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/**
 * Preview quality governor (part 11) — a pure state machine, no React, no DOM.
 *
 * The compositor renders at canvas size × QUALITY_SCALE[level] and upscales.
 * The user picks Full/Half/Quarter; during playback, a sustained dropped-frame
 * ratio above DEGRADE_RATIO_THRESHOLD for DEGRADE_SUSTAIN_SECONDS consecutive
 * ~1s windows steps the *effective* level down one notch (floor: quarter) and
 * flags `degraded` so the surface can show its "Reduced quality" indicator.
 * Pause/stop restores the user-selected level; a manual selection always wins
 * until the next degrade event.
 *
 * Frame measurement is also here (pure, fed from the render loop's rAF
 * deltas): the compositor repaints once per rAF, so rAF cadence *is* the
 * preview frame rate — a stretched delta is exactly a dropped preview frame,
 * on every browser, without per-element requestVideoFrameCallback bookkeeping
 * across clip boundaries. The expected rate is estimated from the fastest
 * frame in each window (clamped to 30–240 Hz) so 120 Hz displays aren't graded
 * against 60 and a healthy 30 Hz display isn't reported as 50% dropped.
 */

export type QualityLevel = 'full' | 'half' | 'quarter';

/** Compositor render scale per level. */
export const QUALITY_SCALE: Record<QualityLevel, number> = {
  full: 1,
  half: 0.5,
  quarter: 0.25,
};

/** Ordered high → low for stepping down. */
export const QUALITY_ORDER: readonly QualityLevel[] = ['full', 'half', 'quarter'];

/** Dropped-frame ratio above which a playback second counts as over budget. */
export const DEGRADE_RATIO_THRESHOLD = 0.2;

/** Consecutive over-budget seconds before stepping quality down. */
export const DEGRADE_SUSTAIN_SECONDS = 2;

export interface GovernorState {
  /** What the user picked (persisted; restored on pause). */
  userLevel: QualityLevel;
  /** What the compositor should render at right now. */
  effectiveLevel: QualityLevel;
  /** True while effectiveLevel is governed below userLevel. */
  degraded: boolean;
  /** Consecutive over-budget seconds accumulated toward the next step-down. */
  overBudgetSeconds: number;
  /** Lifetime count of step-down events (telemetry). */
  degradeActivations: number;
}

export function createGovernor(userLevel: QualityLevel = 'full'): GovernorState {
  return {
    userLevel,
    effectiveLevel: userLevel,
    degraded: false,
    overBudgetSeconds: 0,
    degradeActivations: 0,
  };
}

function stepDown(level: QualityLevel): QualityLevel {
  const i = QUALITY_ORDER.indexOf(level);
  return QUALITY_ORDER[Math.min(QUALITY_ORDER.length - 1, i + 1)];
}

/**
 * Feed one ~1s playback window's dropped-frame ratio. Returns the same state
 * object when nothing changed, so callers can `!==`-check before re-rendering.
 */
export function governorSecond(state: GovernorState, droppedFrameRatio: number): GovernorState {
  if (!(droppedFrameRatio > DEGRADE_RATIO_THRESHOLD)) {
    if (state.overBudgetSeconds === 0) return state;
    return { ...state, overBudgetSeconds: 0 };
  }
  const over = state.overBudgetSeconds + 1;
  if (over < DEGRADE_SUSTAIN_SECONDS) return { ...state, overBudgetSeconds: over };
  const next = stepDown(state.effectiveLevel);
  if (next === state.effectiveLevel) {
    // Already at the floor: stay there, keep counting from zero.
    return { ...state, overBudgetSeconds: 0 };
  }
  return {
    ...state,
    effectiveLevel: next,
    degraded: true,
    overBudgetSeconds: 0,
    degradeActivations: state.degradeActivations + 1,
  };
}

/** Pause/stop: restore the user's chosen level. */
export function governorPause(state: GovernorState): GovernorState {
  if (state.effectiveLevel === state.userLevel && !state.degraded && state.overBudgetSeconds === 0) {
    return state;
  }
  return { ...state, effectiveLevel: state.userLevel, degraded: false, overBudgetSeconds: 0 };
}

/** Manual selection: wins immediately, clears any governed degrade. */
export function governorSetUserLevel(state: GovernorState, level: QualityLevel): GovernorState {
  return {
    ...state,
    userLevel: level,
    effectiveLevel: level,
    degraded: false,
    overBudgetSeconds: 0,
  };
}

// --- Frame-rate measurement ------------------------------------------------

/** Accumulates rAF deltas until ~1s of playback has elapsed. */
export interface FrameStats {
  elapsedMs: number;
  frames: number;
  minDtMs: number;
}

export interface FrameWindowSample {
  /** Frames actually presented per second in this window. */
  fps: number;
  /** 0..1 share of expected frames that were not presented. */
  droppedFrameRatio: number;
}

export const FRAME_WINDOW_MS = 1000;

/** Ignore absurd deltas (tab backgrounded, breakpoint) rather than counting them as drops. */
const MAX_SANE_DT_MS = 1000;

export function createFrameStats(): FrameStats {
  return { elapsedMs: 0, frames: 0, minDtMs: Number.POSITIVE_INFINITY };
}

/**
 * Push one rAF delta. When a window completes, returns the finished sample and
 * a fresh stats object; otherwise `sample` is null.
 */
export function frameStatsPush(
  stats: FrameStats,
  dtMs: number,
): { stats: FrameStats; sample: FrameWindowSample | null } {
  if (!Number.isFinite(dtMs) || dtMs <= 0 || dtMs > MAX_SANE_DT_MS) {
    return { stats, sample: null };
  }
  const next: FrameStats = {
    elapsedMs: stats.elapsedMs + dtMs,
    frames: stats.frames + 1,
    minDtMs: Math.min(stats.minDtMs, dtMs),
  };
  if (next.elapsedMs < FRAME_WINDOW_MS) return { stats: next, sample: null };
  const fps = (next.frames * 1000) / next.elapsedMs;
  // Expected rate ≈ the display refresh, estimated from the fastest frame seen
  // this window and clamped so one glitchy delta can't skew the grade.
  const expectedFps = Math.min(240, Math.max(30, 1000 / Math.max(1, next.minDtMs)));
  const droppedFrameRatio = Math.max(0, Math.min(1, 1 - fps / expectedFps));
  return { stats: createFrameStats(), sample: { fps, droppedFrameRatio } };
}
