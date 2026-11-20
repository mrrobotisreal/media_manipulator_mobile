// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/markerLayout.test.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import { describe, expect, it } from 'vitest';
import { windowMarkers } from './markerLayout';

const m = (id: string, t: number) => ({ id, t, name: id, color: '#22C55E' });

describe('windowMarkers', () => {
  const ms = [m('a', 1), m('b', 50), m('c', 500)];
  it('keeps only markers inside the window', () => {
    expect(windowMarkers(ms, 0, 60).map((x) => x.id)).toEqual(['a', 'b']);
  });
  it('always keeps the selected / edited marker even when off-window', () => {
    expect(windowMarkers(ms, 0, 60, 'c', null).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
});
