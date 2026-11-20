// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/trackAudibility.test.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import { describe, expect, it } from 'vitest';
import type { StudioTrack } from './studioTypes';
import { anySolo, isTrackAudible } from './trackAudibility';

const tr = (kind: 'video' | 'audio', extra: Partial<StudioTrack> = {}): StudioTrack => ({
  id: 'x', kind, index: 0, muted: false, clips: [], ...extra,
});

describe('track audibility (solo semantics)', () => {
  it('no solo: audible unless muted', () => {
    expect(isTrackAudible(tr('audio'), false)).toBe(true);
    expect(isTrackAudible(tr('audio', { muted: true }), false)).toBe(false);
    expect(isTrackAudible(tr('video'), false)).toBe(true);
  });
  it('solo wins over mute', () => {
    expect(isTrackAudible(tr('audio', { solo: true, muted: true }), true)).toBe(true);
  });
  it('with a solo active only soloed audio tracks are heard (video embedded audio included)', () => {
    expect(isTrackAudible(tr('audio'), true)).toBe(false);
    expect(isTrackAudible(tr('video'), true)).toBe(false);
  });
  it('multiple solos are all audible', () => {
    const a = tr('audio', { solo: true });
    const b = tr('audio', { solo: true });
    expect(anySolo([a, b, tr('audio')])).toBe(true);
    expect(isTrackAudible(a, true) && isTrackAudible(b, true)).toBe(true);
  });
  it('a solo flag on a video track is ignored', () => {
    expect(anySolo([tr('video', { solo: true })])).toBe(false);
  });
});

// Shared truth table, identical to media_manipulator_api/internal/models/testdata/track_audibility.json
// (the Go export mirror, models.IsTrackAudible, is tested against the same file).
import fixture from './trackAudibility.fixture.json';

describe('shared audibility truth table (UI == Go export)', () => {
  const mk = (t: { kind: string; muted?: boolean; solo?: boolean; hidden?: boolean }) =>
    tr(t.kind as 'video' | 'audio', { muted: t.muted ?? false, solo: t.solo, hidden: t.hidden });
  for (const c of fixture.anySolo) {
    it(`anySolo: ${c.name}`, () => {
      expect(anySolo(c.tracks.map(mk))).toBe(c.expect);
    });
  }
  for (const c of fixture.audible) {
    it(`isTrackAudible: ${c.name}`, () => {
      expect(isTrackAudible(mk(c.track), c.soloActive)).toBe(c.expect);
    });
  }
});
