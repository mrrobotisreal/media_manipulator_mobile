// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/trackAudibility.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import type { StudioTrack } from './studioTypes';

/**
 * Track solo / mute semantics (Darkroom v3 part 18). Pure; consumed by the
 * preview mixer. Part 19 (audio mixer) owns the export side.
 *
 *  - Solo exists on AUDIO tracks only; any number of tracks may be soloed.
 *  - When at least one audio track is soloed, ONLY soloed audio tracks are
 *    heard: every other track — including a video track's embedded audio — is
 *    silent.
 *  - Solo WINS over mute: a track that is both soloed and muted is audible.
 *  - With no solo active, a track is audible unless muted.
 */
export function anySolo(tracks: readonly StudioTrack[]): boolean {
  return tracks.some((t) => t.kind === 'audio' && t.solo === true);
}

export function isTrackAudible(track: StudioTrack, soloActive: boolean): boolean {
  if (soloActive) return track.kind === 'audio' && track.solo === true;
  return !track.muted;
}
