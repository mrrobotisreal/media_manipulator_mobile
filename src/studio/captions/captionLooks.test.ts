// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/captions/captionLooks.test.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import { describe, expect, it } from 'vitest';
import { studioCaptionStyleSchema } from '../studioTypes';
import { applyCaptionLook, CAPTION_LOOKS, captionAnimationLocked, captionLookLocked, captionLookModified } from './captionLooks';
import { sanitizeCaptionStyle } from './sanitize';

describe('caption looks (decision 7)', () => {
  it('twelve looks (MM122), three anonymous (Minimal, Clean Highlight, Bold Pop)', () => {
    expect(CAPTION_LOOKS.map((l) => l.id)).toEqual([
      'bold_pop', 'karaoke_classic', 'clean_highlight', 'minimal', 'neon', 'podcast',
      'cinema', 'comic', 'typewriter', 'box_pop', 'glow_night', 'bounce_kids',
    ]);
    expect(CAPTION_LOOKS.filter((l) => l.anon).map((l) => l.id).sort()).toEqual(['bold_pop', 'clean_highlight', 'minimal']);
  });

  it('each look is a full, valid style that survives the sanitizer unchanged', () => {
    for (const l of CAPTION_LOOKS) {
      const st = applyCaptionLook(l);
      expect(studioCaptionStyleSchema.safeParse(st).success, l.id).toBe(true);
      expect(sanitizeCaptionStyle(st), l.id).toEqual(st);
      expect(st.lookId).toBe(l.id);
    }
  });

  it('a tweak keeps lookId and marks the style modified', () => {
    const st = applyCaptionLook(CAPTION_LOOKS[0]);
    expect(captionLookModified(st)).toBe(false);
    expect(captionLookModified({ ...st, highlightColor: '#00FF00' })).toBe(true);
  });

  it('locks only for anonymous editors; Free gets every look and animation', () => {
    const neon = CAPTION_LOOKS.find((l) => l.id === 'neon')!;
    expect(captionLookLocked(neon, false)).toBe(true);
    expect(captionLookLocked(neon, true)).toBe(false);
    expect(captionAnimationLocked('karaoke_fill', false)).toBe(true);
    expect(captionAnimationLocked('karaoke_fill', true)).toBe(false);
    expect(captionAnimationLocked('pop', false)).toBe(false);
    for (const a of ['bounce', 'word_by_word', 'box_highlight', 'fade', 'typewriter', 'glow']) {
      expect(captionAnimationLocked(a, false), a).toBe(true);
      expect(captionAnimationLocked(a, true), a).toBe(false);
    }
  });
});
