// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/timelineWindow.test.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import { describe, expect, it } from 'vitest';
import {
  MIN_CLIP_PX,
  quantizeScrollLeft,
  visibleWindow,
  windowClips,
  windowTickRange,
} from './timelineWindow';
import { buildSyntheticProject } from './devSynthetic';
import { clipEnd } from './previewEngine';
import type { StudioClip } from './studioTypes';

const mkClip = (id: string, start: number, len: number): StudioClip => ({
  id,
  assetId: 'a1',
  streamIndex: 0,
  timelineStart: start,
  sourceIn: 0,
  sourceOut: len,
});

describe('visibleWindow', () => {
  it('converts scroll px to seconds with one viewport of overscan each side', () => {
    const w = visibleWindow(1000, 500, 100); // zoom 100 px/s
    expect(w.startSec).toBeCloseTo((1000 - 500) / 100);
    expect(w.endSec).toBeCloseTo((1000 + 500 + 500) / 100);
  });

  it('clamps the start at 0', () => {
    const w = visibleWindow(0, 500, 100);
    expect(w.startSec).toBe(0);
  });

  it('treats an unmeasured viewport as fully visible', () => {
    const w = visibleWindow(1000, 0, 100);
    expect(w.startSec).toBe(0);
    expect(w.endSec).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('quantizeScrollLeft', () => {
  it('steps in half-viewport chunks', () => {
    expect(quantizeScrollLeft(0, 1000)).toBe(0);
    expect(quantizeScrollLeft(499, 1000)).toBe(0);
    expect(quantizeScrollLeft(500, 1000)).toBe(500);
    expect(quantizeScrollLeft(1249, 1000)).toBe(1000);
  });

  it('never goes negative and has a floor chunk for tiny viewports', () => {
    expect(quantizeScrollLeft(-10, 1000)).toBe(0);
    expect(quantizeScrollLeft(130, 10)).toBe(128); // chunk floors at 64
  });
});

describe('windowClips', () => {
  const clips = [mkClip('c0', 0, 10), mkClip('c1', 20, 10), mkClip('c2', 40, 10)];

  it('returns only clips intersecting the window, with px geometry', () => {
    const out = windowClips(clips, { startSec: 15, endSec: 35 }, 10);
    expect(out.map((w) => w.clip.id)).toEqual(['c1']);
    expect(out[0].left).toBe(200);
    expect(out[0].width).toBe(100);
  });

  it('includes boundary-touching clips', () => {
    const out = windowClips(clips, { startSec: 10, endSec: 20 }, 10);
    expect(out.map((w) => w.clip.id)).toEqual(['c0', 'c1']);
  });

  it('always keeps clips in keepIds (dragged/selected) even offscreen', () => {
    const out = windowClips(clips, { startSec: 15, endSec: 35 }, 10, new Set(['c2']));
    expect(out.map((w) => w.clip.id)).toEqual(['c1', 'c2']);
  });

  it('preserves input order and floors width at MIN_CLIP_PX', () => {
    const tiny = [mkClip('t1', 5, 0.01), mkClip('t0', 0, 10)];
    const out = windowClips(tiny, { startSec: 0, endSec: 100 }, 10);
    expect(out.map((w) => w.clip.id)).toEqual(['t1', 't0']);
    expect(out[0].width).toBe(MIN_CLIP_PX);
  });
});

describe('windowTickRange', () => {
  it('bounds tick indices to the window', () => {
    const r = windowTickRange({ startSec: 30, endSec: 62 }, 10, 100);
    expect(r).toEqual({ first: 3, last: 7 });
  });

  it('renders every tick when the window is unbounded', () => {
    const r = windowTickRange({ startSec: 0, endSec: Number.POSITIVE_INFINITY }, 10, 100);
    expect(r).toEqual({ first: 0, last: 99 });
  });
});

describe('scale bound: 1,000-clip / 12-track / 60-min fixture', () => {
  const project = buildSyntheticProject();
  const zoom = 100; // px per second
  const viewport = 1280; // px
  const scrollLeft = quantizeScrollLeft(180_000, viewport); // mid-timeline (~30 min)
  const win = visibleWindow(scrollLeft, viewport, zoom);

  it('the fixture really is at the scale bar', () => {
    const total = project.tracks.reduce((n, t) => n + t.clips.length, 0);
    expect(total).toBe(1000);
    expect(project.tracks).toHaveLength(12);
    expect(project.durationSeconds).toBe(3600);
  });

  it('mounts O(visible) clips, not O(total)', () => {
    let mounted = 0;
    let bruteForce = 0;
    for (const track of project.tracks) {
      mounted += windowClips(track.clips, win, zoom).length;
      bruteForce += track.clips.filter(
        (c) => clipEnd(c) >= win.startSec && c.timelineStart <= win.endSec,
      ).length;
    }
    // Exactly the clips that intersect the window…
    expect(mounted).toBe(bruteForce);
    // …which for a ~38s window over 12 tracks of ~43s clips is a handful, and
    // two orders of magnitude below the 1,000-clip total.
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThanOrEqual(36);
  });

  it('the mounted set stays bounded as the timeline grows longer at fixed density', () => {
    // 4× the timeline, 4× the clips, same clips-per-second: what is on screen
    // is unchanged, so the mounted count must be too (that is O(visible)).
    const longer = buildSyntheticProject({ clipCount: 4000, durationSeconds: 14_400 });
    const mountedBase = project.tracks.reduce((n, t) => n + windowClips(t.clips, win, zoom).length, 0);
    const mountedLonger = longer.tracks.reduce((n, t) => n + windowClips(t.clips, win, zoom).length, 0);
    expect(mountedLonger).toBeLessThanOrEqual(mountedBase + project.tracks.length);
  });
});
