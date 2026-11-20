// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/trackRules.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import type { StudioMediaKind, StudioTrackKind } from './studioTypes';

/**
 * Which media-bin assets a track accepts when dropped (pure).
 * Video tracks hold video and still images; audio tracks hold audio; LUTs are
 * graded onto clips, never placed on a track.
 */
export function trackAcceptsAsset(trackKind: StudioTrackKind, assetKind: StudioMediaKind): boolean {
  if (assetKind === 'lut') return false;
  if (trackKind === 'video') return assetKind === 'video' || assetKind === 'image';
  return assetKind === 'audio';
}
