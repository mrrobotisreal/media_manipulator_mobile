// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/captions/analytics.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/**
 * MM121 caption analytics helpers (closed vocabularies; never caption text).
 */
import type { StudioCaptionCue, StudioCaptionStyle } from '../studioTypes';

/** The animation a burn-in export renders: the style's, 'none' when nothing is burned in. */
export function captionAnimationFor(captionsMode: string | undefined, style: StudioCaptionStyle | undefined, hasCaptions: boolean): string {
  const burns = captionsMode === 'burn_in' || (captionsMode === undefined && hasCaptions);
  if (!burns || !hasCaptions) return 'none';
  return style?.animation ?? 'none';
}

/** True when any cue carries word timings. */
export function cuesHaveWords(cues: readonly StudioCaptionCue[] | undefined): boolean {
  return (cues ?? []).some((c) => (c.words?.length ?? 0) > 0);
}

/** studio_caption_look_saved.count: the account's saved looks after the save, bucketed. */
export function captionLookCountBucket(n: number): '1' | '2-5' | '6-10' | '11-50' | '51+' {
  if (n <= 1) return '1';
  if (n <= 5) return '2-5';
  if (n <= 10) return '6-10';
  if (n <= 50) return '11-50';
  return '51+';
}
