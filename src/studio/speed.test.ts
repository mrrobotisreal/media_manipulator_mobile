// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/speed.test.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import { describe, expect, it } from 'vitest';
import {
  clipSpeed,
  clipTimelineDuration,
  planDuration,
  planFreezeDuration,
  planFreezeInsert,
  planSpeed,
  reverseProxyReady,
  reversedProxyTime,
  sourceTimeAt,
  splitSourcePoint,
  trimPatch,
} from './speed';
import type { StudioClip } from './studioTypes';

const clip = (id: string, timelineStart: number, sourceIn: number, sourceOut: number, extra: Partial<StudioClip> = {}): StudioClip => ({
  id,
  assetId: 'a',
  streamIndex: 0,
  timelineStart,
  sourceIn,
  sourceOut,
  ...extra,
});

describe('duration', () => {
  it('is (out-in)/speed', () => {
    expect(clipTimelineDuration(clip('c', 0, 2, 8))).toBe(6);
    expect(clipTimelineDuration(clip('c', 0, 2, 8, { speed: 2 }))).toBe(3);
    expect(clipTimelineDuration(clip('c', 0, 0, 3, { speed: 0.5 }))).toBe(6);
    expect(clipTimelineDuration(clip('c', 0, 0, 3, { speed: 0.5, reverse: true }))).toBe(6);
  });
  it('freeze ignores speed; out-of-range speed clamps', () => {
    expect(clipTimelineDuration(clip('c', 0, 1, 3, { speed: 4, freeze: { sourceTime: 1 } }))).toBe(2);
    expect(clipSpeed(clip('c', 0, 0, 1, { speed: 99 }))).toBe(10);
    expect(clipSpeed(clip('c', 0, 0, 1, { speed: 0.001 }))).toBe(0.1);
  });
});

describe('source-time mapping', () => {
  const fwd = clip('c', 10, 2, 8, { speed: 2 }); // 6s of source in 3s: timeline [10, 13]
  it('forward: sourceIn + u*speed, boundaries inclusive', () => {
    expect(sourceTimeAt(fwd, 10)).toBe(2);
    expect(sourceTimeAt(fwd, 11)).toBe(4);
    expect(sourceTimeAt(fwd, 13)).toBe(8);
    expect(sourceTimeAt(fwd, 13.5)).toBe(8); // clamped past the end
    expect(sourceTimeAt(fwd, 9)).toBe(2); // clamped before the start
  });
  it('reverse: sourceOut - u*speed', () => {
    const rev = clip('c', 10, 2, 8, { speed: 2, reverse: true });
    expect(sourceTimeAt(rev, 10)).toBe(8);
    expect(sourceTimeAt(rev, 11)).toBe(6);
    expect(sourceTimeAt(rev, 13)).toBe(2);
  });
  it('slow-mo', () => {
    const slow = clip('c', 0, 0, 2, { speed: 0.5 });
    expect(sourceTimeAt(slow, 2)).toBe(1);
    expect(sourceTimeAt(slow, 4)).toBe(2);
  });
  it('freeze is constant', () => {
    const fz = clip('c', 5, 3, 5, { freeze: { sourceTime: 3.25 } });
    expect(sourceTimeAt(fz, 5)).toBe(3.25);
    expect(sourceTimeAt(fz, 6.9)).toBe(3.25);
  });
  it('reversed proxy time mirrors the original axis', () => {
    expect(reversedProxyTime(8, 10)).toBe(2);
    expect(reversedProxyTime(0, 10)).toBe(10);
    expect(reversedProxyTime(3, 0)).toBe(3); // unknown duration: passthrough
    // A reversed clip played FORWARD from the reversed proxy at `speed` traces sourceTimeAt:
    const rev = clip('c', 0, 2, 8, { speed: 2, reverse: true });
    const dur = 10;
    expect(reversedProxyTime(sourceTimeAt(rev, 0), dur)).toBe(2);
    expect(reversedProxyTime(sourceTimeAt(rev, 3), dur)).toBe(8);
  });
});

describe('planSpeed (no ripple, neighbour clamp)', () => {
  const a = clip('a', 0, 0, 4); // [0,4]
  const b = clip('b', 6, 0, 4); // starts at 6: 2s of room after a
  it('speed-up never clamps against neighbours', () => {
    const p = planSpeed([a, b], a, 4);
    expect(p).toMatchObject({ speed: 4, clamped: false, duration: 1 });
  });
  it('slow-down is allowed up to the next clip start', () => {
    expect(planSpeed([a, b], a, 0.8)).toMatchObject({ speed: 0.8, clamped: false });
  });
  it('slow-down beyond the next clip clamps with a neighbour reason', () => {
    const p = planSpeed([a, b], a, 0.5); // wants 8s, only 6 available
    expect(p.clamped).toBe(true);
    expect(p.reason).toBe('neighbor');
    expect(p.speed).toBeCloseTo(4 / 6, 9);
    expect(p.duration).toBeCloseTo(6, 9);
    expect(p.maxDuration).toBe(6);
  });
  it('no next clip = unbounded growth up to the range floor', () => {
    const p = planSpeed([a], a, 0.1);
    expect(p).toMatchObject({ speed: 0.1, clamped: false });
    expect(p.maxDuration).toBe(Infinity);
  });
  it('range clamp', () => {
    expect(planSpeed([a], a, 50)).toMatchObject({ speed: 10, clamped: true, reason: 'range' });
    expect(planSpeed([a], a, 0.01)).toMatchObject({ speed: 0.1, clamped: true, reason: 'range' });
  });
  it('a short span cannot go faster than the minimum clip length allows', () => {
    const short = clip('s', 0, 0, 0.5);
    const p = planSpeed([short], short, 10);
    expect(p.reason).toBe('minLength');
    expect(p.duration).toBeGreaterThanOrEqual(0.1 - 1e-9);
  });
  it('an already-overlapping clip is not forced to shrink, but cannot grow', () => {
    const o = clip('o', 0, 0, 4); // [0,4]
    const next = clip('n', 3, 0, 4); // overlaps (transition)
    const same = planSpeed([o, next], o, 1);
    expect(same.clamped).toBe(false);
    const slower = planSpeed([o, next], o, 0.5);
    expect(slower.clamped).toBe(true);
    expect(slower.speed).toBeCloseTo(1, 9);
  });
});

describe('planDuration (back-solve)', () => {
  const a = clip('a', 0, 0, 4);
  it('duration -> speed', () => {
    expect(planDuration([a], a, 2).speed).toBe(2);
    expect(planDuration([a], a, 8).speed).toBe(0.5);
  });
  it('clamps through planSpeed', () => {
    const b = clip('b', 5, 0, 1);
    const p = planDuration([a, b], a, 20);
    expect(p.clamped).toBe(true);
    expect(p.duration).toBeCloseTo(5, 9);
  });
  it('freeze duration is bounded by the next clip', () => {
    const fz = clip('f', 0, 1, 3, { freeze: { sourceTime: 1 } });
    const nx = clip('n', 4, 0, 1);
    expect(planFreezeDuration([fz, nx], fz, 3)).toMatchObject({ duration: 3, clamped: false });
    expect(planFreezeDuration([fz, nx], fz, 9)).toMatchObject({ duration: 4, clamped: true });
  });
});

describe('planFreezeInsert', () => {
  const a = clip('a', 0, 0, 4, { speed: 2 }); // timeline [0,2]
  it('starts at the clip end, 2s by default, source frame at the playhead', () => {
    const p = planFreezeInsert([a], a, 1)!;
    expect(p.timelineStart).toBe(2);
    expect(p.duration).toBe(2);
    expect(p.sourceTime).toBe(2); // t=1 at 2x
    expect(p.bounded).toBe(false);
  });
  it('is bounded by the neighbour', () => {
    const n = clip('n', 3, 0, 1);
    const p = planFreezeInsert([a, n], a, 1)!;
    expect(p.duration).toBe(1);
    expect(p.bounded).toBe(true);
  });
  it('returns null with no room', () => {
    const n = clip('n', 2.05, 0, 1);
    expect(planFreezeInsert([a, n], a, 1)).toBeNull();
  });
});

describe('trimPatch', () => {
  const limits = { assetDuration: 20 };
  it('is the classic arithmetic at 1x forward', () => {
    const c = clip('c', 5, 2, 8);
    expect(trimPatch(c, 'l', 1, limits)).toEqual({ sourceIn: 3, sourceOut: 8, timelineStart: 6 });
    expect(trimPatch(c, 'r', 2, limits)).toEqual({ sourceIn: 2, sourceOut: 10, timelineStart: 5 });
  });
  it('maps timeline drag through speed', () => {
    const c = clip('c', 5, 2, 8, { speed: 2 });
    expect(trimPatch(c, 'r', 1, limits)).toMatchObject({ sourceOut: 10 }); // +1 timeline s = +2 source s
    expect(trimPatch(c, 'l', 1, limits)).toMatchObject({ sourceIn: 4, timelineStart: 6 });
  });
  it('reversed: the right (end) edge moves sourceIn, the left edge moves sourceOut', () => {
    const c = clip('c', 5, 4, 8, { reverse: true });
    expect(trimPatch(c, 'r', -1, limits)).toMatchObject({ sourceIn: 5, sourceOut: 8 }); // shrink end
    expect(trimPatch(c, 'l', 1, limits)).toMatchObject({ sourceOut: 7, sourceIn: 4, timelineStart: 6 });
  });
  it('clamps to the asset and the minimum length', () => {
    const c = clip('c', 5, 2, 8);
    expect(trimPatch(c, 'r', 100, limits).sourceOut).toBe(20);
    expect(trimPatch(c, 'r', -100, limits).sourceOut).toBeCloseTo(2.1, 9);
    expect(trimPatch(c, 'l', -100, limits).sourceIn).toBe(0);
  });
  it('unbounded assets (Infinity) never clamp growth', () => {
    const c = clip('c', 0, 0, 5);
    expect(trimPatch(c, 'r', 50, { assetDuration: Infinity }).sourceOut).toBe(55);
  });
  it('freeze clips resize freely', () => {
    const c = clip('c', 5, 1, 3, { freeze: { sourceTime: 1 } });
    expect(trimPatch(c, 'r', 3, limits)).toMatchObject({ sourceOut: 6 });
  });
});

describe('splitSourcePoint', () => {
  it('maps through speed and direction', () => {
    expect(splitSourcePoint(clip('c', 0, 2, 8, { speed: 2 }), 1)).toBe(4);
    expect(splitSourcePoint(clip('c', 0, 2, 8, { speed: 2, reverse: true }), 1)).toBe(6);
  });
});

describe('reverseProxyReady', () => {
  it('ready via lifecycle or persisted key (not while processing)', () => {
    expect(reverseProxyReady({ asset: {} })).toBe(false);
    expect(reverseProxyReady({ reversed: 'ready', asset: {} })).toBe(true);
    expect(reverseProxyReady({ asset: { s3KeyProxyReversed: 'k' } })).toBe(true);
    expect(reverseProxyReady({ reversed: 'processing', asset: { s3KeyProxyReversed: 'k' } })).toBe(false);
    expect(reverseProxyReady({ reversed: 'failed', asset: {} })).toBe(false);
  });
});
