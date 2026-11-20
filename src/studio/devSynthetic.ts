// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/devSynthetic.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import { STUDIO_SCHEMA_VERSION, type StudioProject, type StudioTrack } from './studioTypes';

/**
 * Dev-only synthetic large-project generator (part 11). Builds an in-memory
 * EDL at the documented scale bar — 1,000 clips / 12 tracks / 60 minutes —
 * referencing a single tiny asset id, so the virtualization and windowing
 * assertions (and future workstation profiling) can run without real media.
 *
 * Never imported by production code paths: usage sites are Vitest suites and
 * `process.env.NODE_ENV !== 'production'`-guarded dev hooks. Deterministic by
 * construction (no Date.now / random) so test fixtures are stable.
 */

export interface SyntheticProjectOptions {
  clipCount?: number;
  videoTracks?: number;
  audioTracks?: number;
  durationSeconds?: number;
  /** Every clip references this one asset. */
  assetId?: string;
  fps?: number;
  width?: number;
  height?: number;
}

export const SYNTHETIC_ASSET_ID = 'synthetic-asset';

export function buildSyntheticProject(options: SyntheticProjectOptions = {}): StudioProject {
  const {
    clipCount = 1000,
    videoTracks = 8,
    audioTracks = 4,
    durationSeconds = 3600,
    assetId = SYNTHETIC_ASSET_ID,
    fps = 30,
    width = 1920,
    height = 1080,
  } = options;

  const trackCount = Math.max(1, videoTracks + audioTracks);
  const tracks: StudioTrack[] = [];
  for (let t = 0; t < trackCount; t += 1) {
    const isVideo = t < videoTracks;
    // Distribute clips as evenly as possible: the first (clipCount % trackCount)
    // tracks get one extra.
    const base = Math.floor(clipCount / trackCount);
    const extra = t < clipCount % trackCount ? 1 : 0;
    const clipsInTrack = base + extra;
    const clipLen = clipsInTrack > 0 ? durationSeconds / clipsInTrack : 0;
    const kindPrefix = isVideo ? 'v' : 'a';
    const index = isVideo ? t : t - videoTracks;
    tracks.push({
      id: `syn-track-${kindPrefix}${index}`,
      kind: isVideo ? 'video' : 'audio',
      index,
      muted: false,
      clips: Array.from({ length: clipsInTrack }, (_, k) => ({
        id: `syn-clip-${kindPrefix}${index}-${k}`,
        assetId,
        streamIndex: 0,
        timelineStart: k * clipLen,
        sourceIn: 0,
        sourceOut: clipLen,
      })),
    });
  }

  return {
    id: 'syn-project',
    name: 'Synthetic scale project',
    schemaVersion: STUDIO_SCHEMA_VERSION,
    fps,
    width,
    height,
    durationSeconds,
    tracks,
    captions: [],
    captionsEnabled: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}
