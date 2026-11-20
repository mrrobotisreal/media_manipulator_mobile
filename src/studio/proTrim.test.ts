// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/proTrim.test.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import { describe, expect, it } from 'vitest';
import type { StudioClip } from './studioTypes';
import { clipEnd } from './previewEngine';
import {
  findEditPair,
  planRippleToPlayhead,
  planRippleTrim,
  planRoll,
  planSlide,
  planSlip,
} from './proTrim';

const clip = (id: string, start: number, sIn: number, sOut: number, extra: Partial<StudioClip> = {}): StudioClip => ({
  id, assetId: 'a', streamIndex: 0, timelineStart: start, sourceIn: sIn, sourceOut: sOut, ...extra,
});
const ASSET = 30;
const bound = () => ASSET;
const unbounded = () => Infinity;
const by = (cs: StudioClip[], id: string) => cs.find((c) => c.id === id)!;

describe('roll', () => {
  // A: timeline 0..5 source 5..10 ; B: timeline 5..10 source 10..15
  const clips = [clip('A', 0, 5, 10), clip('B', 5, 10, 15)];

  it('moves A out and B in together; pair length is invariant', () => {
    const p = planRoll(clips, 5, 2, bound)!;
    expect(p.applied).toBe(2);
    expect(by(p.clips, 'A').sourceOut).toBe(12);
    expect(by(p.clips, 'B').sourceIn).toBe(12);
    expect(by(p.clips, 'B').timelineStart).toBe(7);
    expect(clipEnd(by(p.clips, 'B'))).toBe(10);
  });

  it('rolls left too', () => {
    const p = planRoll(clips, 5, -3, bound)!;
    expect(by(p.clips, 'A').sourceOut).toBe(7);
    expect(by(p.clips, 'B').timelineStart).toBe(2);
    expect(by(p.clips, 'B').sourceIn).toBe(7);
  });

  it('is clamped by B having no media before its head', () => {
    const tight = [clip('A', 0, 0, 5), clip('B', 5, 1, 6)];
    expect(planRoll(tight, 5, -4, bound)!.applied).toBe(-1);
  });

  it('is clamped by A running out of source', () => {
    const near = [clip('A', 0, 25, 29), clip('B', 4, 0, 4)];
    expect(planRoll(near, 4, 5, bound)!.applied).toBe(1);
  });

  it('keeps the minimum clip length', () => {
    const p = planRoll(clips, 5, 100, bound)!;
    expect(p.applied).toBeCloseTo(5 - 0.1, 6);
  });

  it('returns null when there is no shared edit point', () => {
    expect(planRoll([clip('A', 0, 0, 4), clip('B', 6, 0, 4)], 4, 1, bound)).toBeNull();
    expect(findEditPair(clips, 99)).toBeNull();
  });

  it('honors speed: a 2x clip consumes 2 source seconds per timeline second', () => {
    const fast = [clip('A', 0, 0, 10, { speed: 2 }), clip('B', 5, 10, 15)];
    const p = planRoll(fast, 5, 1, bound)!;
    expect(by(p.clips, 'A').sourceOut).toBe(12); // +1 timeline s = +2 source s
    expect(by(p.clips, 'B').sourceIn).toBe(11);
    expect(by(p.clips, 'B').timelineStart).toBe(6);
  });

  it('a still image on the A side may roll right without a source bound (MM14)', () => {
    const img = [clip('A', 0, 0, 5), clip('B', 5, 10, 15)];
    expect(planRoll(img, 5, 3, unbounded)!.applied).toBe(3);
  });
});

describe('slip', () => {
  const c = clip('c', 10, 5, 10);
  it('shifts the source window; position and duration stay fixed', () => {
    const r = planSlip(c, 2, ASSET)!;
    expect(r.applied).toBe(2);
    expect(r.clip.sourceIn).toBe(7);
    expect(r.clip.sourceOut).toBe(12);
    expect(r.clip.timelineStart).toBe(10);
  });
  it('clamps at the head and the tail of the asset', () => {
    expect(planSlip(c, -50, ASSET)!.applied).toBe(-5);
    expect(planSlip(c, 500, ASSET)!.clip.sourceOut).toBe(ASSET);
  });
  it('is unavailable for stills, titles and freeze frames', () => {
    expect(planSlip(c, 1, Infinity)).toBeNull(); // still image: unbounded -> no source range
    expect(planSlip(clip('t', 0, 0, 5, { title: { layers: [] } }), 1, Infinity)).toBeNull();
    expect(planSlip(clip('f', 0, 3, 5, { freeze: { sourceTime: 3 } }), 1, ASSET)).toBeNull();
  });
  it('slips a sped-up clip in SOURCE seconds without changing its timeline duration', () => {
    const fast = clip('s', 0, 4, 14, { speed: 2 }); // 10 source s -> 5 timeline s
    const r = planSlip(fast, 3, ASSET)!;
    expect(r.clip.sourceOut - r.clip.sourceIn).toBe(10);
  });
});

describe('slide', () => {
  // prev 0..4 (src 0..4), mid 4..8 (src 10..14), next 8..12 (src 5..9)
  const clips = [clip('p', 0, 0, 4), clip('m', 4, 10, 14), clip('n', 8, 5, 9)];
  it('moves the clip while neighbors absorb; total length unchanged', () => {
    const r = planSlide(clips, 'm', 1.5, bound)!;
    expect(r.applied).toBe(1.5);
    expect(by(r.clips, 'm').timelineStart).toBe(5.5);
    expect(by(r.clips, 'p').sourceOut).toBe(5.5);
    expect(by(r.clips, 'n').timelineStart).toBe(9.5);
    expect(by(r.clips, 'n').sourceIn).toBe(6.5);
    expect(clipEnd(by(r.clips, 'n'))).toBe(12);
    expect(by(r.clips, 'm').sourceIn).toBe(10); // own source untouched
  });
  it('clamps when a neighbor hits zero (minimum length)', () => {
    const r = planSlide(clips, 'm', 100, bound)!;
    expect(r.applied).toBeCloseTo(3.9, 6);
  });
  it('clamps when a neighbor runs out of source', () => {
    const r = planSlide(clips, 'm', -100, bound)!;
    // n can only grow left by sourceIn=5; p can shrink by 3.9 -> -3.9 first
    expect(r.applied).toBeCloseTo(-3.9, 6);
    const r2 = planSlide([clip('p', 0, 0, 4), clip('m', 4, 10, 14), clip('n', 8, 0.5, 4.5)], 'm', -100, bound)!;
    expect(r2.applied).toBeCloseTo(-0.5, 6);
  });
  it('a gap neighbor does not absorb: the slide is bounded by it instead of overlapping', () => {
    const gappy = [clip('m', 4, 10, 14), clip('n', 9, 0, 4)];
    const r = planSlide(gappy, 'm', 3, bound)!;
    expect(r.applied).toBe(1); // 8 + 1 = 9, flush with n; n unchanged
    expect(by(r.clips, 'n')).toBe(gappy[1]);
  });
  it('cannot slide past the timeline start', () => {
    const solo = [clip('m', 1, 0, 4)];
    expect(planSlide(solo, 'm', -5, bound)!.applied).toBe(-1);
  });
});

describe('ripple trim', () => {
  const clips = [clip('a', 0, 0, 4), clip('b', 4, 0, 4), clip('c', 8, 0, 4)];
  it('right-trim shortens the clip and pulls later clips left', () => {
    const r = planRippleTrim(clips, 'b', 'r', -1.5, bound)!;
    expect(r.applied).toBe(-1.5);
    expect(by(r.clips, 'b').sourceOut).toBe(2.5);
    expect(by(r.clips, 'c').timelineStart).toBe(6.5);
    expect(by(r.clips, 'a').timelineStart).toBe(0);
  });
  it('left-trim keeps the clip start and closes the gap behind it', () => {
    const r = planRippleTrim(clips, 'b', 'l', 1, bound)!;
    expect(by(r.clips, 'b').timelineStart).toBe(4);
    expect(by(r.clips, 'b').sourceIn).toBe(1);
    expect(by(r.clips, 'c').timelineStart).toBe(7);
  });
  it('speed-aware: 2x clip trims 2 source seconds per timeline second', () => {
    const c2 = [clip('a', 0, 0, 8, { speed: 2 }), clip('b', 4, 0, 4)];
    const r = planRippleTrim(c2, 'a', 'r', -1, bound)!;
    expect(by(r.clips, 'a').sourceOut).toBe(6);
    expect(by(r.clips, 'b').timelineStart).toBe(3);
  });
  it('a stretched still may grow right unbounded and pushes later clips', () => {
    const img = [clip('i', 0, 0, 5), clip('b', 5, 0, 4)];
    const r = planRippleTrim(img, 'i', 'r', 10, unbounded)!;
    expect(by(r.clips, 'i').sourceOut).toBe(15);
    expect(by(r.clips, 'b').timelineStart).toBe(15);
  });
});

describe('ripple to playhead (Q / W)', () => {
  const clips = [clip('a', 0, 0, 4), clip('b', 4, 0, 4), clip('c', 8, 0, 4)];
  it('W trims the tail of the clip under the playhead and ripples', () => {
    const r = planRippleToPlayhead(clips, 6, 'next', bound)!;
    expect(by(r.clips, 'b').sourceOut).toBe(2);
    expect(by(r.clips, 'c').timelineStart).toBe(6);
  });
  it('Q trims the head of the clip under the playhead and ripples', () => {
    const r = planRippleToPlayhead(clips, 6, 'prev', bound)!;
    expect(by(r.clips, 'b').sourceIn).toBe(2);
    expect(by(r.clips, 'b').timelineStart).toBe(4);
    expect(by(r.clips, 'c').timelineStart).toBe(6);
  });
  it('in a gap, Q closes the gap before the playhead and W the gap after it', () => {
    const gappy = [clip('a', 0, 0, 4), clip('b', 10, 0, 4)];
    const q = planRippleToPlayhead(gappy, 7, 'prev', bound)!;
    expect(by(q.clips, 'b').timelineStart).toBe(7);
    const w = planRippleToPlayhead(gappy, 7, 'next', bound)!;
    expect(by(w.clips, 'b').timelineStart).toBe(7);
  });
  it('does nothing past the last clip or exactly on an edit', () => {
    expect(planRippleToPlayhead(clips, 50, 'next', bound)).toBeNull();
    expect(planRippleToPlayhead(clips, 4, 'prev', bound)).toBeNull();
  });
});

describe('ripple head-trim at the timeline start', () => {
  it('can extend the head of a clip at t=0 (the track closes up around it)', () => {
    const cs = [clip('a', 0, 3, 7), clip('b', 4, 0, 4)];
    const r = planRippleTrim(cs, 'a', 'l', -2, bound)!;
    expect(r.applied).toBe(-2);
    expect(by(r.clips, 'a').timelineStart).toBe(0);
    expect(by(r.clips, 'a').sourceIn).toBe(1);
    expect(by(r.clips, 'b').timelineStart).toBe(6);
  });
});
