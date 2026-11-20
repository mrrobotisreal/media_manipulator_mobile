// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/devSynthetic.test.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import { describe, expect, it } from 'vitest';
import { SYNTHETIC_ASSET_ID, buildSyntheticProject } from './devSynthetic';
import { clipEnd } from './previewEngine';
import { studioProjectSchema } from './studioTypes';

describe('buildSyntheticProject', () => {
  const project = buildSyntheticProject();

  it('is a valid EDL per the shared Zod schema', () => {
    expect(() => studioProjectSchema.parse(project)).not.toThrow();
  });

  it('hits the documented scale bar: 1,000 clips / 12 tracks / 60 minutes', () => {
    expect(project.tracks).toHaveLength(12);
    expect(project.tracks.filter((t) => t.kind === 'video')).toHaveLength(8);
    expect(project.tracks.filter((t) => t.kind === 'audio')).toHaveLength(4);
    expect(project.tracks.reduce((n, t) => n + t.clips.length, 0)).toBe(1000);
    expect(project.durationSeconds).toBe(3600);
  });

  it('references a single tiny asset id from every clip', () => {
    for (const track of project.tracks) {
      for (const clip of track.clips) expect(clip.assetId).toBe(SYNTHETIC_ASSET_ID);
    }
  });

  it('lays clips out back-to-back with no overlaps, filling the timeline', () => {
    for (const track of project.tracks) {
      for (let i = 0; i < track.clips.length; i += 1) {
        const c = track.clips[i];
        if (i > 0) expect(c.timelineStart).toBeCloseTo(clipEnd(track.clips[i - 1]), 6);
      }
      const last = track.clips[track.clips.length - 1];
      expect(clipEnd(last)).toBeCloseTo(3600, 6);
    }
  });

  it('is deterministic and respects custom sizes', () => {
    expect(buildSyntheticProject()).toEqual(project);
    const small = buildSyntheticProject({ clipCount: 10, videoTracks: 1, audioTracks: 1, durationSeconds: 60 });
    expect(small.tracks.reduce((n, t) => n + t.clips.length, 0)).toBe(10);
    expect(() => studioProjectSchema.parse(small)).not.toThrow();
  });
});
