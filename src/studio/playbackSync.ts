// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/playbackSync.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/**
 * Preview playback sync policy (MM70) — pure, no React, no DOM.
 *
 * The preview's playhead is the master clock (driven by the audio output
 * clock, see preview-surface.tsx). Every pooled media element is a slave that
 * must track `target` (its source position under the playhead). This module
 * decides, once per animation frame and per element, what to do about the
 * gap between the element and its target:
 *
 *   - hold   — leave it alone (in-flight seek, buffering, or settling);
 *   - rate   — nudge `playbackRate` by up to ±NUDGE_MAX_RATIO to close a small
 *              drift smoothly (video only; master audio is never stretched);
 *   - seek   — hard-seek, while playing to `target + measured seek latency`
 *              (a LEAD) so the element lands where the playhead will be when
 *              the seek completes, not where it was when it was issued;
 *   - defer  — paused/scrubbing: an exact seek is in flight, remember the
 *              newest target for the `seeked` handler to re-issue.
 *
 * Why (the MM70 bug): the previous policy hard-seeked to the CURRENT target
 * whenever drift exceeded 0.3 s. A seek takes L seconds to land (network round
 * trip for an unbuffered range + decoding from the previous keyframe), so it
 * always landed L behind; with L > 0.3 s that is already over the threshold,
 * so it seeked again — forever. The picture froze on each seek and never
 * caught up while the audio (cheap to seek, never drifting) played on; pausing
 * "fixed" it only because a paused target stops moving. Leads, cooldowns,
 * nudging, and stuck-state recovery below make that loop impossible.
 */

/** HTMLMediaElement.HAVE_CURRENT_DATA — the frame at currentTime is decoded (enough while paused). */
export const HAVE_CURRENT_DATA = 2;
/** HTMLMediaElement.HAVE_FUTURE_DATA — enough data to play forward. */
export const HAVE_FUTURE_DATA = 3;

/** |drift| (timeline seconds) treated as in sync. ~1 frame at 30 fps. */
export const DEAD_BAND_S = 0.03;
/** Up to this |drift| (timeline seconds) video is corrected by nudging playbackRate. */
export const NUDGE_WINDOW_S = 0.4;
/** Rate correction per second of drift (proportional gain), before clamping: 0.1 s behind → +10%. */
export const NUDGE_GAIN = 1;
/** Max relative playbackRate change while nudging (±10%). */
export const NUDGE_MAX_RATIO = 0.1;
/** Audio-only (non-nudged) elements re-seek past this |drift| (timeline seconds) — the pre-MM70 value. */
export const AUDIO_RESYNC_S = 0.3;
/** Paused / frozen: an element further than this from its target is seeked exactly. */
export const EXACT_TOLERANCE_S = 0.05;
/** Never issue two playing-mode seeks on one element closer than this. */
export const MIN_RESEEK_MS = 500;
/** After a seek lands, allow this long for playback to start before re-seeking. */
export const SETTLE_MS = 300;
/** A seek still `seeking` after max(this, 4 × latency) is presumed lost and re-issued. */
export const SEEK_STUCK_MIN_MS = 3000;
/** Playing but below HAVE_FUTURE_DATA for this long (no seek in flight) is presumed stuck. */
export const BUFFER_STUCK_MS = 2500;
/** Latency estimate before any seek has been measured. */
export const DEFAULT_SEEK_LATENCY_MS = 300;
/** Latency estimate bounds (and so the lead bounds). */
export const MIN_SEEK_LATENCY_MS = 30;
export const MAX_SEEK_LATENCY_MS = 8000;

/** What the planner needs to know about one media element right now. */
export interface MediaSnapshot {
  currentTime: number;
  seeking: boolean;
  readyState: number;
}

/** Per-element bookkeeping carried between frames. Treat as immutable. */
export interface SlotSyncState {
  /** performance.now() of the last seek this policy issued (or src load). */
  lastSeekAt: number | null;
  /** True from a seek until it is playable again (the latency sample point). */
  awaitingLanding: boolean;
  /** Whether the landing reports a latency sample (false for cold src loads, whose cost is not a seek's). */
  measure: boolean;
  /** performance.now() when the last seek became playable. */
  landedAt: number | null;
  /** performance.now() when the element (playing, not seeking) dropped below HAVE_FUTURE_DATA. */
  bufferingSince: number | null;
  /** Consecutive stuck re-issues without a landing (doubles the stuck timeout each time, max ×8). */
  stuckStreak: number;
  /** Lifetime seeks issued for this element (diagnostics / telemetry). */
  seeks: number;
}

export function createSlotSync(): SlotSyncState {
  return {
    lastSeekAt: null,
    awaitingLanding: false,
    measure: false,
    landedAt: null,
    bufferingSince: null,
    stuckStreak: 0,
    seeks: 0,
  };
}

/**
 * Record a seek the caller issued outside planSync (the `seeked` re-issue), or
 * a fresh `src` load with `measure = false` so its load time never inflates the
 * seek-latency estimate.
 */
export function noteSeekIssued(state: SlotSyncState, nowMs: number, measure = true): SlotSyncState {
  return { ...state, lastSeekAt: nowMs, awaitingLanding: true, measure, bufferingSince: null, seeks: state.seeks + 1 };
}

export interface SyncInput {
  el: MediaSnapshot;
  /** Where the element should be now (its own media time axis, seconds). */
  target: number;
  /** The clip's speed: media seconds per timeline second (> 0). */
  baseRate: number;
  /** True while the timeline plays AND the clip advances (not frozen / pending). */
  playing: boolean;
  nowMs: number;
  /** Current seek-latency estimate (ms), see nextLatencyEstimate. */
  latencyMs: number;
  /** Upper bound for seek targets (media duration), when known. */
  maxTime?: number;
  /** False for audio-only elements: never time-stretch the master audio. */
  nudge: boolean;
}

export type SyncAction =
  | { kind: 'hold'; rate: number }
  | { kind: 'rate'; rate: number }
  | { kind: 'seek'; time: number; rate: number; reason: 'drift' | 'stuck' | 'exact' }
  | { kind: 'defer'; time: number; rate: number };

export interface SyncResult {
  state: SlotSyncState;
  action: SyncAction;
  /** Issue→playable time of a seek that just landed (ms), to feed the estimate. */
  latencySampleMs?: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Fast attack, slow release: one slow seek raises the lead at once; fast ones decay it. */
export function nextLatencyEstimate(prevMs: number, sampleMs: number): number {
  if (!Number.isFinite(sampleMs) || sampleMs < 0) return prevMs;
  const next = sampleMs > prevMs ? sampleMs : prevMs * 0.7 + sampleMs * 0.3;
  return clamp(next, MIN_SEEK_LATENCY_MS, MAX_SEEK_LATENCY_MS);
}

/** How long a seek may stay `seeking` before it is presumed lost. */
export function seekStuckMs(latencyMs: number): number {
  return Math.max(SEEK_STUCK_MIN_MS, 4 * latencyMs);
}

/** How long a playing element may sit below HAVE_FUTURE_DATA before it is re-kicked. */
export function bufferStuckMs(latencyMs: number): number {
  return Math.max(BUFFER_STUCK_MS, 4 * latencyMs);
}

function seekTarget(input: SyncInput, lead: boolean): number {
  const leadS = lead ? (clamp(input.latencyMs, MIN_SEEK_LATENCY_MS, MAX_SEEK_LATENCY_MS) / 1000) * input.baseRate : 0;
  const hi = input.maxTime !== undefined && Number.isFinite(input.maxTime) && input.maxTime > 0 ? input.maxTime - 0.05 : Infinity;
  return Math.max(0, Math.min(hi, input.target + leadS));
}

function issue(state: SlotSyncState, input: SyncInput, reason: 'drift' | 'stuck' | 'exact', rate: number): SyncResult {
  return {
    state: noteSeekIssued(state, input.nowMs),
    action: { kind: 'seek', time: seekTarget(input, reason !== 'exact'), rate, reason },
  };
}

/** Decide what to do with one element this frame. */
export function planSync(prev: SlotSyncState, input: SyncInput): SyncResult {
  const { el, nowMs } = input;
  const base = input.baseRate > 0 ? input.baseRate : 1;
  let state = prev;
  let latencySampleMs: number | undefined;

  // Landing: the first frame a seek is done AND usable (playable while playing,
  // the frame decoded while paused) closes the latency sample.
  const ready = input.playing ? HAVE_FUTURE_DATA : HAVE_CURRENT_DATA;
  if (state.awaitingLanding && !el.seeking && el.readyState >= ready) {
    if (state.lastSeekAt !== null && state.measure) latencySampleMs = nowMs - state.lastSeekAt;
    state = { ...state, awaitingLanding: false, landedAt: nowMs, stuckStreak: 0 };
  }
  const done = (action: SyncAction, s: SlotSyncState = state): SyncResult =>
    latencySampleMs === undefined ? { state: s, action } : { state: s, action, latencySampleMs };
  const withSample = (r: SyncResult): SyncResult =>
    latencySampleMs === undefined ? r : { ...r, latencySampleMs };

  const sinceSeek = state.lastSeekAt === null ? Infinity : nowMs - state.lastSeekAt;
  const backoff = 2 ** Math.min(3, state.stuckStreak);
  const seekLost = el.seeking && sinceSeek > seekStuckMs(input.latencyMs) * backoff;

  if (!input.playing) {
    // Paused, scrubbing, frozen: frame-exact, one seek in flight (newest wins).
    if (Math.abs(el.currentTime - input.target) <= EXACT_TOLERANCE_S) return done({ kind: 'hold', rate: base });
    if (el.seeking && !seekLost) return done({ kind: 'defer', time: input.target, rate: base });
    return withSample(issue(state, input, 'exact', base));
  }

  if (el.seeking) {
    // Never pile a seek onto one in flight; only a lost seek is re-issued.
    // Each consecutive re-issue doubles the wait (stuckStreak), so a link
    // where every seek is merely very slow still gets one that lands — and
    // that landing's latency then sizes the lead.
    if (seekLost) return withSample(issue({ ...state, stuckStreak: state.stuckStreak + 1 }, input, 'stuck', base));
    return done({ kind: 'hold', rate: base });
  }

  const drift = (el.currentTime - input.target) / base; // timeline seconds; < 0 = behind
  const abs = Math.abs(drift);
  const canReseek = sinceSeek >= MIN_RESEEK_MS && (state.landedAt === null || nowMs - state.landedAt >= SETTLE_MS);

  if (el.readyState < HAVE_FUTURE_DATA) {
    // Buffering (no seek in flight). Data at a position already well behind is
    // useless — jump ahead; otherwise wait, and re-kick a buffer that never fills.
    const since = state.bufferingSince ?? nowMs;
    if (state.bufferingSince === null) state = { ...state, bufferingSince: since };
    const largeDrift = abs > (input.nudge ? NUDGE_WINDOW_S : AUDIO_RESYNC_S);
    if (largeDrift && canReseek && !state.awaitingLanding) return withSample(issue(state, input, 'drift', base));
    const stuckAfter = bufferStuckMs(input.latencyMs);
    if (nowMs - since > stuckAfter * backoff && sinceSeek > stuckAfter * backoff) {
      return withSample(issue({ ...state, stuckStreak: state.stuckStreak + 1 }, input, 'stuck', base));
    }
    return done({ kind: 'hold', rate: base });
  }
  if (state.bufferingSince !== null) state = { ...state, bufferingSince: null };

  if (abs <= DEAD_BAND_S) return done({ kind: 'rate', rate: base });

  if (!input.nudge) {
    if (abs <= AUDIO_RESYNC_S || !canReseek) return done({ kind: 'rate', rate: base });
    return withSample(issue(state, input, 'drift', base));
  }

  const correction = clamp(-drift * NUDGE_GAIN, -NUDGE_MAX_RATIO, NUDGE_MAX_RATIO);
  const nudged = quantizeRate(base * (1 + correction));
  if (abs <= NUDGE_WINDOW_S || !canReseek) return done({ kind: 'rate', rate: nudged });
  return withSample(issue(state, input, 'drift', base));
}

/** Rates are quantized to 1% so a slowly changing drift doesn't rewrite playbackRate every frame. */
export function quantizeRate(rate: number): number {
  return Math.round(rate * 100) / 100;
}

/**
 * Master clock step (MM70). The playhead advances by the AUDIO OUTPUT clock
 * when one is running (AudioContext time, interpolated with its output
 * timestamp by the caller), so the playhead and what is heard never part; it
 * falls back to the rAF delta when there is no running context (not created
 * yet, suspended) or the audio clock jumps implausibly (device change).
 */
const AUDIO_CLOCK_JITTER_S = 0.05;
const AUDIO_CLOCK_STALL_S = 0.1;

export function masterClockStep(
  prevAudioS: number | null,
  audioNowS: number | null,
  rafDtS: number,
): { dt: number; audio: number | null } {
  const raf = Number.isFinite(rafDtS) && rafDtS > 0 ? rafDtS : 0;
  if (audioNowS === null || !Number.isFinite(audioNowS)) return { dt: raf, audio: null };
  if (prevAudioS === null) return { dt: raf, audio: audioNowS };
  const adt = audioNowS - prevAudioS;
  // A fresh output timestamp can land a hair behind the extrapolated one: hold.
  if (adt < 0 && adt > -AUDIO_CLOCK_JITTER_S) return { dt: 0, audio: prevAudioS };
  // Backwards, an implausible jump, or an audio clock that stopped while the
  // display kept going (output device gone): the display clock takes over.
  if (adt < 0 || adt > Math.max(0.5, raf * 2 + 0.1) || (adt === 0 && raf > AUDIO_CLOCK_STALL_S)) {
    return { dt: raf, audio: audioNowS };
  }
  return { dt: adt, audio: audioNowS };
}

/** Warm the next clip on a track this many timeline seconds before it starts. */
export const WARM_LOOKAHEAD_S = 2;

/** The minimal clip shape the warm-up planner reads. */
export interface WarmCandidate {
  clipId: string;
  trackId: string;
  timelineStart: number;
}

/**
 * Clips that start within (t, t + lookahead] — the ones worth loading into a
 * spare decoder now, so the cut lands on an element already buffered at its
 * first frame instead of a cold `src` load (the slowest seek there is). Sorted
 * soonest first so a short pool warms the most urgent clip.
 */
export function upcomingClips<T extends WarmCandidate>(candidates: readonly T[], t: number, lookahead = WARM_LOOKAHEAD_S): T[] {
  return candidates
    .filter((c) => c.timelineStart > t && c.timelineStart <= t + lookahead)
    .sort((a, b) => a.timelineStart - b.timelineStart);
}
