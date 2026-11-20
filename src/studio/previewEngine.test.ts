// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/previewEngine.test.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import { describe, expect, it, vi } from 'vitest';

// The URL builders in previewEngine read the active StudioBackend, whose module
// pulls in the auth/analytics stack. The timeline math under test never touches
// it — stub the boundary so the suite stays pure.
vi.mock('@/lib/studio/studioBackend', () => ({
  getActiveStudioBackend: () => {
    throw new Error('studioBackend must not be reached from previewEngine unit tests');
  },
}));

import {
  audioFadeGain,
  clipDuration,
  clipEnd,
  clipTransitionOf,
  clipTransitionState,
  nextClipOnTrack,
  nextClipOverlap,
  prevClipOverlap,
  timelineDuration,
  transitionFrameState,
  resolveActiveClips,
  transitionRamp,
  topVideoClip,
  volumeAtClipTime,
  clipValuesAt,
  type ActiveClip,
} from './previewEngine';
import type { StudioClip, StudioTrack, StudioTrackKind, StudioTransitionType } from './studioTypes';

const clip = (id: string, timelineStart: number, dur: number, extra: Partial<StudioClip> = {}): StudioClip => ({
  id,
  assetId: 'asset-1',
  streamIndex: 0,
  timelineStart,
  sourceIn: 0,
  sourceOut: dur,
  ...extra,
});

const track = (id: string, kind: StudioTrackKind, index: number, clips: StudioClip[]): StudioTrack => ({
  id,
  kind,
  index,
  muted: false,
  clips,
});

describe('clip geometry', () => {
  it('clipDuration is sourceOut - sourceIn, floored at 0', () => {
    expect(clipDuration(clip('c', 0, 0, { sourceIn: 2, sourceOut: 7 }))).toBe(5);
    expect(clipDuration(clip('c', 0, 0, { sourceIn: 7, sourceOut: 2 }))).toBe(0);
  });

  it('clipEnd is timelineStart + duration', () => {
    expect(clipEnd(clip('c', 3, 0, { sourceIn: 1, sourceOut: 4 }))).toBe(6);
  });

  it('timelineDuration is the latest clip end across all tracks', () => {
    const tracks = [
      track('v1', 'video', 0, [clip('a', 0, 5)]),
      track('a1', 'audio', 0, [clip('b', 2, 10)]),
    ];
    expect(timelineDuration(tracks)).toBe(12);
    expect(timelineDuration([])).toBe(0);
  });
});

describe('resolveActiveClips', () => {
  const tracks = [
    // a: 0..5, b: 4..9 — overlapping during b's 1s cross-dissolve.
    track('v1', 'video', 0, [clip('a', 0, 5), clip('b', 4, 5, { transitionInSeconds: 1 })]),
    track('a1', 'audio', 0, [clip('m', 0, 20)]),
  ];

  it('returns both overlapping clips of a cross-dissolve with mapped source times', () => {
    const active = resolveActiveClips(tracks, 4.5);
    const videoActive = active.filter((a) => a.trackKind === 'video');
    expect(videoActive.map((a) => a.clip.id)).toEqual(['a', 'b']);
    expect(videoActive[0].sourceTime).toBe(4.5); // a: sourceIn 0 + (4.5 - 0)
    expect(videoActive[1].sourceTime).toBe(0.5); // b: sourceIn 0 + (4.5 - 4)
  });

  it('includes audio clips with the track metadata the mixer needs', () => {
    const active = resolveActiveClips(tracks, 4.5);
    const audio = active.find((a) => a.clip.id === 'm');
    expect(audio).toMatchObject({ trackId: 'a1', trackKind: 'audio', trackIndex: 0, trackMuted: false, sourceTime: 4.5 });
  });

  it('treats clip spans as half-open: active at start, inactive at end', () => {
    const solo = [track('v1', 'video', 0, [clip('a', 1, 4)])];
    expect(resolveActiveClips(solo, 1).map((a) => a.clip.id)).toEqual(['a']);
    expect(resolveActiveClips(solo, 5)).toEqual([]);
    expect(resolveActiveClips(solo, 0.5)).toEqual([]);
  });

  it('maps source time through a trimmed in-point', () => {
    const trimmed = [track('v1', 'video', 0, [clip('a', 2, 0, { sourceIn: 10, sourceOut: 18 })])];
    expect(resolveActiveClips(trimmed, 5)[0].sourceTime).toBe(13);
  });
});

describe('transitionRamp', () => {
  it('is 1 for clips with no transition', () => {
    expect(transitionRamp(clip('a', 2, 5), 2)).toBe(1);
    expect(transitionRamp(clip('a', 2, 5, { transitionInSeconds: 0 }), 2)).toBe(1);
  });

  it('is 0 at the clip start and before it', () => {
    const c = clip('a', 2, 5, { transitionInSeconds: 1 });
    expect(transitionRamp(c, 2)).toBe(0);
    expect(transitionRamp(c, 1)).toBe(0);
  });

  it('ramps linearly across the transition window', () => {
    const c = clip('a', 2, 5, { transitionInSeconds: 2 });
    expect(transitionRamp(c, 2.5)).toBeCloseTo(0.25);
    expect(transitionRamp(c, 3)).toBeCloseTo(0.5);
    expect(transitionRamp(c, 3.5)).toBeCloseTo(0.75);
  });

  it('is 1 from the end of the ramp onward', () => {
    const c = clip('a', 2, 5, { transitionInSeconds: 1 });
    expect(transitionRamp(c, 3)).toBe(1);
    expect(transitionRamp(c, 6)).toBe(1);
  });
});

describe('topVideoClip', () => {
  const active = (id: string, kind: StudioTrackKind, trackIndex: number): ActiveClip => ({
    clip: clip(id, 0, 5),
    trackId: `t-${id}`,
    trackKind: kind,
    trackIndex,
    trackMuted: false,
    sourceTime: 0,
  });

  it('picks the video clip on the highest-indexed track', () => {
    const result = topVideoClip([active('base', 'video', 0), active('overlay', 'video', 2), active('mid', 'video', 1)]);
    expect(result?.clip.id).toBe('overlay');
  });

  it('ignores audio clips and handles an empty list', () => {
    expect(topVideoClip([active('m', 'audio', 3)])).toBeUndefined();
    expect(topVideoClip([])).toBeUndefined();
  });
});

describe('volumeAtClipTime', () => {
  it('returns the flat volume (default 1) when there are no keyframes', () => {
    expect(volumeAtClipTime(clip('a', 0, 5), 2)).toBe(1);
    expect(volumeAtClipTime(clip('a', 0, 5, { volume: 0.4 }), 2)).toBe(0.4);
    expect(volumeAtClipTime(clip('a', 0, 5, { volume: 0.4, volumeKeyframes: [] }), 2)).toBe(0.4);
  });

  it('holds the first keyframe value before it and the last after it', () => {
    const c = clip('a', 0, 10, { volumeKeyframes: [{ t: 2, gain: 0.2 }, { t: 6, gain: 1.8 }] });
    expect(volumeAtClipTime(c, 0)).toBe(0.2);
    expect(volumeAtClipTime(c, 2)).toBe(0.2);
    expect(volumeAtClipTime(c, 6)).toBe(1.8);
    expect(volumeAtClipTime(c, 9)).toBe(1.8);
  });

  it('interpolates linearly between keyframes', () => {
    const c = clip('a', 0, 10, { volumeKeyframes: [{ t: 2, gain: 0 }, { t: 6, gain: 1 }] });
    expect(volumeAtClipTime(c, 3)).toBeCloseTo(0.25);
    expect(volumeAtClipTime(c, 4)).toBeCloseTo(0.5);
    expect(volumeAtClipTime(c, 5)).toBeCloseTo(0.75);
  });

  it('interpolates across multiple segments', () => {
    const c = clip('a', 0, 10, {
      volumeKeyframes: [
        { t: 0, gain: 1 },
        { t: 4, gain: 0 },
        { t: 8, gain: 2 },
      ],
    });
    expect(volumeAtClipTime(c, 2)).toBeCloseTo(0.5);
    expect(volumeAtClipTime(c, 6)).toBeCloseTo(1);
  });

  it('keyframes override the flat volume', () => {
    const c = clip('a', 0, 10, { volume: 0.1, volumeKeyframes: [{ t: 0, gain: 1.5 }] });
    expect(volumeAtClipTime(c, 5)).toBe(1.5);
  });
});

describe('audio crossfades (equal-power, overlap-driven, mirroring export afade qsin)', () => {
  it('overlaps derive from actual clip positions, not the declared transition', () => {
    const a = clip('a', 0, 5);
    const b = clip('b', 4, 5, { transitionInSeconds: 2 }); // declared 2s, real overlap 1s
    expect(nextClipOverlap([a, b], a)).toBe(1);
    expect(prevClipOverlap([a, b], b)).toBe(1);
    expect(nextClipOverlap([a, b], b)).toBe(0);
    expect(nextClipOverlap([a], a)).toBe(0);
  });

  it('breaks timelineStart ties by array order (stable sort, like Go)', () => {
    const a = clip('a', 0, 5);
    const b = clip('b', 0, 5);
    expect(nextClipOnTrack([a, b], a)).toBe(b);
    expect(nextClipOnTrack([a, b], b)).toBeUndefined();
    expect(nextClipOverlap([a, b], a)).toBe(5);
  });

  it('fade-in follows sin(x·π/2) over the overlap with the predecessor', () => {
    const p = clip('p', 6, 6); // ends at 12
    const c = clip('c', 10, 4); // overlap [10, 12] — NO transition field needed
    expect(audioFadeGain(c, [p, c], 10)).toBeCloseTo(0);
    expect(audioFadeGain(c, [p, c], 11)).toBeCloseTo(Math.SQRT1_2);
    expect(audioFadeGain(c, [p, c], 12.5)).toBe(1);
  });

  it('fade-out spans the tail over the overlap with the NEXT clip, curve sin((1−x)·π/2)', () => {
    const a = clip('a', 0, 6);
    const b = clip('b', 4.5, 6); // automatic: overlap alone triggers the crossfade
    // fade-out window: [4.5, 6) on clip a
    expect(audioFadeGain(a, [a, b], 4)).toBe(1);
    expect(audioFadeGain(a, [a, b], 5.25)).toBeCloseTo(Math.SQRT1_2);
    expect(audioFadeGain(a, [a, b], 5.999)).toBeCloseTo(Math.sin((Math.PI / 2) * (1 - 0.999 / 1)), 2);
  });

  it('a crossfade sums to constant power (sin² + cos² = 1)', () => {
    const a = clip('a', 0, 6);
    const b = clip('b', 4.5, 6);
    for (const t of [4.6, 5, 5.4, 5.9]) {
      const gOut = audioFadeGain(a, [a, b], t);
      const gIn = audioFadeGain(b, [a, b], t);
      expect(gOut * gOut + gIn * gIn).toBeCloseTo(1);
    }
  });

  it('skips the fade-out when the overlap would cover the whole clip (export parity)', () => {
    const a = clip('a', 0, 1);
    const b = clip('b', 0, 5); // full-cover overlap = a's duration
    // clamped fadeOut = dur → export omits afade out (dur > FadeOut fails)
    expect(audioFadeGain(a, [a, b], 0.9)).toBe(1);
  });
});

describe('transitionFrameState (typed transitions, part 14)', () => {
  const IDENT = { alpha: 1, offsetX: 0, offsetY: 0 };

  it('crossDissolve ramps B alpha linearly, A untouched', () => {
    expect(transitionFrameState('crossDissolve', 0).b.alpha).toBe(0);
    expect(transitionFrameState('crossDissolve', 0.5).b.alpha).toBe(0.5);
    expect(transitionFrameState('crossDissolve', 1).b.alpha).toBe(1);
    expect(transitionFrameState('crossDissolve', 0.5).a).toEqual(IDENT);
    expect(transitionFrameState('crossDissolve', 0.5).dip).toBeUndefined();
  });

  it('clamps progress outside 0..1', () => {
    expect(transitionFrameState('crossDissolve', -1).b.alpha).toBe(0);
    expect(transitionFrameState('crossDissolve', 2).b.alpha).toBe(1);
  });

  it('dips peak the color layer at p=0.5 and switch B under full color', () => {
    for (const [type, color] of [['dipToBlack', 'black'], ['dipToWhite', 'white']] as const) {
      expect(transitionFrameState(type, 0).dip).toEqual({ color, alpha: 0 });
      expect(transitionFrameState(type, 0.25).dip?.alpha).toBeCloseTo(0.5);
      expect(transitionFrameState(type, 0.5).dip).toEqual({ color, alpha: 1 });
      expect(transitionFrameState(type, 0.75).dip?.alpha).toBeCloseTo(0.5);
      expect(transitionFrameState(type, 1).dip?.alpha).toBeCloseTo(0);
      expect(transitionFrameState(type, 0.25).b.alpha).toBe(0); // hidden first half
      expect(transitionFrameState(type, 0.5).b.alpha).toBe(1); // opaque from midpoint
      expect(transitionFrameState(type, 0.25).a).toEqual(IDENT);
    }
  });

  it('wipes reveal B from the named edge (direction = where B comes from)', () => {
    expect(transitionFrameState('wipeLeft', 0.25).b.wipe).toEqual({ left: 0, top: 0, right: 0.75, bottom: 0 });
    expect(transitionFrameState('wipeRight', 0.25).b.wipe).toEqual({ left: 0.75, top: 0, right: 0, bottom: 0 });
    expect(transitionFrameState('wipeUp', 0.25).b.wipe).toEqual({ left: 0, top: 0, right: 0, bottom: 0.75 });
    expect(transitionFrameState('wipeDown', 0.25).b.wipe).toEqual({ left: 0, top: 0.75, right: 0, bottom: 0 });
    expect(transitionFrameState('wipeLeft', 1).b.wipe).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
    expect(transitionFrameState('wipeLeft', 0.5).a).toEqual(IDENT);
    expect(transitionFrameState('wipeLeft', 0.5).b.alpha).toBe(1); // fully opaque where revealed
  });

  it('pushes move BOTH clips; direction = where B comes from', () => {
    const pl = transitionFrameState('pushLeft', 0.25);
    expect(pl.b.offsetX).toBeCloseTo(-0.75);
    expect(pl.a.offsetX).toBeCloseTo(0.25);
    const pr = transitionFrameState('pushRight', 0.25);
    expect(pr.b.offsetX).toBeCloseTo(0.75);
    expect(pr.a.offsetX).toBeCloseTo(-0.25);
    const pu = transitionFrameState('pushUp', 0.25);
    expect(pu.b.offsetY).toBeCloseTo(-0.75);
    expect(pu.a.offsetY).toBeCloseTo(0.25);
    const pd = transitionFrameState('pushDown', 0.25);
    expect(pd.b.offsetY).toBeCloseTo(0.75);
    expect(pd.a.offsetY).toBeCloseTo(-0.25);
    // Boundaries: B off-canvas at p=0, home at p=1; A home at p=0.
    expect(transitionFrameState('pushLeft', 0).b.offsetX).toBe(-1);
    expect(transitionFrameState('pushLeft', 1).b.offsetX).toBeCloseTo(0);
    expect(transitionFrameState('pushLeft', 0).a.offsetX).toBe(0);
  });

  it('slides move only B over a static A', () => {
    for (const [type, key, sign] of [
      ['slideLeft', 'offsetX', -1],
      ['slideRight', 'offsetX', 1],
      ['slideUp', 'offsetY', -1],
      ['slideDown', 'offsetY', 1],
    ] as const) {
      const s = transitionFrameState(type as StudioTransitionType, 0.25);
      expect(s.b[key]).toBeCloseTo(sign * 0.75);
      expect(s.a).toEqual(IDENT);
    }
  });
});

describe('clipTransitionOf + clipTransitionState', () => {
  it('prefers the typed field and upgrades legacy transitionInSeconds', () => {
    const typed = clip('t', 0, 5, { transition: { type: 'wipeUp', durationSeconds: 2 }, transitionInSeconds: 2 });
    expect(clipTransitionOf(typed)?.type).toBe('wipeUp');
    const legacy = clip('l', 0, 5, { transitionInSeconds: 1.5 });
    expect(clipTransitionOf(legacy)).toEqual({ type: 'crossDissolve', durationSeconds: 1.5 });
    expect(clipTransitionOf(clip('n', 0, 5))).toBeUndefined();
  });

  it('applies the entering clip mods inside its own window', () => {
    const a = clip('a', 0, 5);
    const b = clip('b', 4, 5, { transition: { type: 'slideLeft', durationSeconds: 1 } });
    const mid = clipTransitionState(b, [a, b], 4.5);
    expect(mid.offsetX).toBeCloseTo(-0.5);
    const after = clipTransitionState(b, [a, b], 5.5);
    expect(after).toMatchObject({ alpha: 1, offsetX: 0, offsetY: 0 });
  });

  it('applies the NEXT clip push to the outgoing clip, and carries the dip once', () => {
    const a = clip('a', 0, 5);
    const b = clip('b', 4, 5, { transition: { type: 'pushLeft', durationSeconds: 1 } });
    const outgoing = clipTransitionState(a, [a, b], 4.5);
    expect(outgoing.offsetX).toBeCloseTo(0.5);
    expect(outgoing.dip).toBeUndefined();
    const dipB = clip('b2', 4, 5, { transition: { type: 'dipToBlack', durationSeconds: 1 } });
    const entering = clipTransitionState(dipB, [a, dipB], 4.5);
    expect(entering.dip).toEqual({ color: 'black', alpha: 1 });
    const outgoingUnderDip = clipTransitionState(a, [a, dipB], 4.5);
    expect(outgoingUnderDip.dip).toBeUndefined(); // emitted only from B's layer
  });
});

// --- part 15: keyframed property resolver -----------------------------------

describe('clipValuesAt', () => {
  it('falls back to static fields when no lanes exist', () => {
    const c = clip('c', 0, 5, {
      transform: { x: 0.2, y: -0.1, scale: 1.5, rotationDeg: 45 },
      opacity: 0.8,
      volume: 1.2,
      pan: -0.5,
    });
    const v = clipValuesAt(c, 2);
    expect(v.transform).toEqual({ x: 0.2, y: -0.1, scale: 1.5, rotationDeg: 45 });
    expect(v.opacity).toBe(0.8);
    expect(v.volume).toBe(1.2);
    expect(v.pan).toBe(-0.5);
    expect(v.effects).toBeUndefined();
  });

  it('a keyframed lane overrides its static field; other props keep statics', () => {
    const c = clip('c', 0, 4, {
      transform: { x: 0.2, y: 0.3, scale: 1, rotationDeg: 0 },
      keyframes: {
        positionX: [
          { t: 0, value: -1, ease: 'linear' },
          { t: 4, value: 1, ease: 'linear' },
        ],
        opacity: [
          { t: 0, value: 0, ease: 'easeIn' },
          { t: 2, value: 1, ease: 'linear' },
        ],
      },
    });
    const v = clipValuesAt(c, 2);
    expect(v.transform.x).toBe(0); // keyframed midpoint
    expect(v.transform.y).toBe(0.3); // static survives
    expect(v.opacity).toBe(1);
    expect(clipValuesAt(c, 1).opacity).toBeCloseTo(0.25, 9); // easeIn f² at f=0.5
  });

  it('keyframes.volume wins over legacy volumeKeyframes; legacy still works alone', () => {
    const legacyOnly = clip('c', 0, 4, {
      volumeKeyframes: [
        { t: 0, gain: 0 },
        { t: 4, gain: 2 },
      ],
    });
    expect(clipValuesAt(legacyOnly, 2).volume).toBe(1);
    const both = clip('c', 0, 4, {
      volumeKeyframes: [
        { t: 0, gain: 0 },
        { t: 4, gain: 2 },
      ],
      keyframes: { volume: [{ t: 0, value: 0.5, ease: 'linear' }] },
    });
    expect(clipValuesAt(both, 2).volume).toBe(0.5);
    expect(volumeAtClipTime(both, 2)).toBe(0.5);
  });

  it('resolves effect-param lanes under "<effectId>.<param>" keys', () => {
    const c = clip('c', 0, 4, {
      keyframes: {
        effects: {
          'lum1.exposure': [
            { t: 0, value: 0, ease: 'linear' },
            { t: 4, value: 2, ease: 'linear' },
          ],
        },
      },
    });
    expect(clipValuesAt(c, 2).effects).toEqual({ 'lum1.exposure': 1 });
  });
});

describe('speed controls in the resolver (part 17)', () => {
  it('clipDuration/clipEnd are speed-aware', () => {
    const c = clip('c', 2, 6, { speed: 2 }); // 6s of source at 2x
    expect(clipDuration(c)).toBe(3);
    expect(clipEnd(c)).toBe(5);
    expect(clipDuration(clip('f', 0, 2, { freeze: { sourceTime: 1 }, speed: 4 }))).toBe(2);
  });

  it('timelineDuration uses the shrunken end; the gap remains', () => {
    const tr = [track('v', 'video', 0, [clip('a', 0, 8, { speed: 4 }), clip('b', 8, 2)])];
    expect(timelineDuration(tr)).toBe(10);
    expect(clipEnd(tr[0].clips[0])).toBe(2); // a ends at 2 -> gap [2, 8)
  });

  it('active only inside the retimed span, with the mapped source time', () => {
    const tr = [track('v', 'video', 0, [clip('a', 10, 6, { sourceIn: 2, sourceOut: 8, speed: 2 })])];
    expect(resolveActiveClips(tr, 9.99)).toHaveLength(0);
    expect(resolveActiveClips(tr, 11)[0].sourceTime).toBe(4);
    expect(resolveActiveClips(tr, 12.99)[0].sourceTime).toBeCloseTo(7.98, 9);
    expect(resolveActiveClips(tr, 13)).toHaveLength(0); // [10, 13)
  });

  it('reverse mirrors; freeze is constant over any duration', () => {
    const rev = [track('v', 'video', 0, [clip('a', 0, 6, { sourceIn: 2, sourceOut: 8, reverse: true })])];
    expect(resolveActiveClips(rev, 0)[0].sourceTime).toBe(8);
    expect(resolveActiveClips(rev, 2)[0].sourceTime).toBe(6);
    const fz = [track('v', 'video', 0, [clip('f', 5, 4, { sourceIn: 3, sourceOut: 7, freeze: { sourceTime: 3.5 } })])];
    expect(resolveActiveClips(fz, 5)[0].sourceTime).toBe(3.5);
    expect(resolveActiveClips(fz, 8.5)[0].sourceTime).toBe(3.5);
    expect(resolveActiveClips(fz, 9)).toHaveLength(0);
  });
});
