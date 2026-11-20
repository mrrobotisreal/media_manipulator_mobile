// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/clipTrimBound.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import type { StudioAsset } from './studioTypes';

/**
 * The right-trim bound for a clip, in source seconds. Title clips and still
 * images have no source length, so they may be stretched without limit; media
 * clips are bound by the asset duration. The result is a TRANSIENT gesture
 * bound only: Infinity must never be written into the document (JSON turns it
 * into null).
 */
export function clipTrimBound(
  asset: Pick<StudioAsset, 'mediaKind' | 'durationSeconds'> | undefined,
  isTitle: boolean,
): number {
  if (isTitle || asset?.mediaKind === 'image') return Number.POSITIVE_INFINITY;
  return asset?.durationSeconds ?? 0;
}
