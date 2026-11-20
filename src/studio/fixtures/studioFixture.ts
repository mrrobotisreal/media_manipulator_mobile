// DO NOT EDIT. Copied from media-manipulator-ui lib/assistant/ops/studioFixture.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/**
 * MM109: a small Darkroom project for Medi's studio op tests (two video clips on V1, a voice
 * and a music track), mirroring the eval fixture `studio/two-clips.json` in the API.
 */
import type { StudioProject } from '../studioTypes';

export const STUDIO_FIXTURE_ASSETS: Record<string, { mediaKind: 'video' | 'audio' | 'image'; durationSeconds: number; name: string }> = {
  beach: { mediaKind: 'video', durationSeconds: 20, name: 'beach.mp4' },
  city: { mediaKind: 'video', durationSeconds: 30, name: 'city.mp4' },
  voice: { mediaKind: 'audio', durationSeconds: 24, name: 'voiceover.wav' },
  song: { mediaKind: 'audio', durationSeconds: 180, name: 'song.mp3' },
  still: { mediaKind: 'image', durationSeconds: 0, name: 'logo.png' },
};

export function studioFixture(): StudioProject {
  return {
    id: 'proj-1',
    name: 'Trip',
    schemaVersion: 3,
    fps: 30,
    width: 1920,
    height: 1080,
    durationSeconds: 24,
    tracks: [
      {
        id: 'tv1',
        kind: 'video',
        index: 0,
        muted: false,
        clips: [
          { id: 'clipA', assetId: 'beach', streamIndex: 0, timelineStart: 0, sourceIn: 0, sourceOut: 12 },
          { id: 'clipB', assetId: 'city', streamIndex: 0, timelineStart: 12, sourceIn: 3, sourceOut: 15 },
        ],
      },
      { id: 'ta1', kind: 'audio', index: 0, muted: false, name: 'Voice', clips: [{ id: 'voice1', assetId: 'voice', streamIndex: 0, timelineStart: 0, sourceIn: 0, sourceOut: 24 }] },
      { id: 'ta2', kind: 'audio', index: 1, muted: false, name: 'Music', clips: [{ id: 'music1', assetId: 'song', streamIndex: 0, timelineStart: 0, sourceIn: 0, sourceOut: 24 }] },
    ],
    captions: [],
    captionsEnabled: true,
    markers: [],
    createdAt: '2026-11-05T00:00:00Z',
    updatedAt: '2026-11-05T00:00:00Z',
  };
}
