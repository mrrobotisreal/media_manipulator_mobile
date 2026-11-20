// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/duckingEnvelope.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/**
 * duckingEnvelope — pure math for the LEVEL-DRIVEN preview auto-ducking
 * (part 12 parity closure). The export ducks the bed through
 * `sidechaincompress=threshold=0.02:ratio=duckRatio(amountDb):attack:release`
 * keyed by the voice group (studio_export.go). The preview approximates that
 * from the already-ingested waveform peaks of the voice-track clips: a static
 * downward-compressor curve maps the voice peak level to a bed gain, and a
 * one-pole attack/release envelope smooths it over timeline time.
 *
 * Documented approximations (see docs/content-studio/design/03-parity-tolerances.md):
 * peak buckets stand in for the compressor's RMS detector, the soft knee is
 * ignored (hard knee), and smoothing advances at rAF rate rather than per
 * sample. When peaks are unavailable (embed backends without /peaks, or still
 * loading) callers fall back to presence-driven level 1.
 */

/** Mirrors sidechaincompress `threshold=0.02` in studio_export.go (≈ −34 dBFS). */
export const DUCK_THRESHOLD = 0.02;

/** Mirrors duckRatio() in studio_export.go: ratio = clamp(1 + amountDb, 1, 20). */
export function duckCompressionRatio(amountDb: number): number {
  return Math.min(20, Math.max(1, 1 + amountDb));
}

/** The minimal peaks shape needed here (structural subset of DecodedPeaks). */
export interface PeaksLike {
  bucketsPerSecond: number;
  /** number of min/max buckets (peaks.length === length * 2) */
  length: number;
  peaks: Int8Array;
}

/**
 * peakLevelAt reads the linear peak level (0..1) at a source-media time from
 * the int8 [min,max] bucket pairs the /peaks endpoint serves.
 */
export function peakLevelAt(peaks: PeaksLike, sourceSeconds: number): number {
  if (peaks.length <= 0 || peaks.bucketsPerSecond <= 0) return 0;
  const idx = Math.min(
    peaks.length - 1,
    Math.max(0, Math.floor(sourceSeconds * peaks.bucketsPerSecond)),
  );
  const mn = peaks.peaks[idx * 2] ?? 0;
  const mx = peaks.peaks[idx * 2 + 1] ?? 0;
  return Math.min(1, Math.max(Math.abs(mn), Math.abs(mx)) / 127);
}

/**
 * bedGainForVoiceLevel is the static compressor curve: below the threshold the
 * bed is untouched; above it the overshoot is divided by the ratio, so the
 * gain is (T + (L−T)/ratio) / L — the sidechaincompress transfer function with
 * a hard knee and makeup=1.
 */
export function bedGainForVoiceLevel(level: number, amountDb: number): number {
  const ratio = duckCompressionRatio(amountDb);
  if (ratio <= 1 || level <= DUCK_THRESHOLD) return 1;
  const compressed = DUCK_THRESHOLD + (level - DUCK_THRESHOLD) / ratio;
  return Math.min(1, Math.max(0, compressed / level));
}

export interface DuckEnvelopeState {
  /** smoothed bed gain (0..1) */
  gain: number;
  /** timeline time of the last advance, null before the first */
  t: number | null;
}

export const INITIAL_DUCK_ENVELOPE: DuckEnvelopeState = { gain: 1, t: null };

/**
 * advanceEnvelope smooths the target bed gain with the project's attack
 * (gain falling — voice rising) / release (gain recovering) time constants,
 * driven by TIMELINE time so it is deterministic and scrub-safe: on the first
 * sample, a backwards jump, or a gap > 0.5 s (seek) it snaps to the target.
 */
export function advanceEnvelope(
  state: DuckEnvelopeState,
  target: number,
  tSeconds: number,
  cfg: { attackMs: number; releaseMs: number },
): DuckEnvelopeState {
  if (state.t === null) return { gain: target, t: tSeconds };
  const dt = tSeconds - state.t;
  if (dt <= 0 || dt > 0.5) return { gain: target, t: tSeconds };
  const tauMs = target < state.gain ? cfg.attackMs : cfg.releaseMs;
  const tau = Math.max(0.001, tauMs / 1000);
  return { gain: target + (state.gain - target) * Math.exp(-dt / tau), t: tSeconds };
}
