// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/ease.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
'worklet'; // MA62: runs on the UI runtime (scripts/sync-studio.mjs WORKLET_FILES)
import type { StudioKeyframe, StudioKeyframeEase } from './studioTypes';

/**
 * Keyframe curve math (part 15) — THE cross-side contract for how keyframed
 * values interpolate. internal/services/studio_keyframes.go mirrors these exact
 * curves (as Go math AND as ffmpeg expression emission); both sides are
 * fixture-tested against the same value table (ease.fixtures.json, copied to
 * the Go repo's testdata). Change the curves in both places or neither.
 *
 * Curve definitions, on normalized segment progress f ∈ [0,1]:
 *   linear    f
 *   hold      0 (the outgoing value holds until the next keyframe)
 *   easeIn    f²
 *   easeOut   1 − (1−f)²
 *   easeBoth  f < 0.5 ? 2f² : 1 − 2(1−f)²   (the research ticket 01 curve)
 *
 * SEGMENT EASE COMES FROM THE LEFT KEYFRAME: the span [a, b) interpolates
 * a.value → b.value using a.ease (like CSS keyframe timing functions). Before
 * the first keyframe the first value holds; after the last, the last holds.
 */

/** easedProgress maps linear progress f (clamped 0..1) through an ease curve. */
export function easedProgress(ease: StudioKeyframeEase, f: number): number {
  const p = f < 0 ? 0 : f > 1 ? 1 : f;
  switch (ease) {
    case 'hold':
      return 0;
    case 'easeIn':
      return p * p;
    case 'easeOut':
      return 1 - (1 - p) * (1 - p);
    case 'easeBoth':
      return p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p);
    case 'linear':
    default:
      return p;
  }
}

/**
 * valueAt evaluates a keyframe lane at clip-local time `t`. Keyframes are
 * assumed sorted by t (the store + Go sanitizer both normalize on write).
 * Returns `fallback` when the lane is empty/absent.
 */
export function valueAt(
  keyframes: StudioKeyframe[] | undefined,
  t: number,
  fallback = 0,
): number {
  if (!keyframes || keyframes.length === 0) return fallback;
  const first = keyframes[0];
  if (t <= first.t) return first.value;
  const last = keyframes[keyframes.length - 1];
  if (t >= last.t) return last.value;
  for (let i = 1; i < keyframes.length; i += 1) {
    const b = keyframes[i];
    // Segments are [a, b): at exactly b.t the value IS b's (hold jumps AT the
    // next keyframe, matching the export's [START,END) sendcmd intervals).
    if (t < b.t) {
      const a = keyframes[i - 1];
      const span = b.t - a.t;
      if (span <= 0) return b.value;
      const f = (t - a.t) / span;
      return a.value + (b.value - a.value) * easedProgress(a.ease, f);
    }
  }
  return last.value;
}
