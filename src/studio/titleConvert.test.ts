// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/titleConvert.test.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import { describe, expect, it } from 'vitest';
import { titleFromTextOverlays, titleTextLayerFromOverlay } from './titleConvert';
import { studioTitleSchema } from './studioTypes';
import type { StudioTextOverlay } from './studioTypes';

// Legacy textOverlays → title-clip conversion (part 16).

const overlay = (over: Partial<StudioTextOverlay> = {}): StudioTextOverlay => ({
  id: 'ov1',
  text: 'Hello',
  x: 0.5,
  y: 0.8,
  fontSize: 48,
  color: '#FFEE00',
  ...over,
});

describe('titleTextLayerFromOverlay', () => {
  it('carries text/position/size/color and the legacy look (bold + dark plate)', () => {
    const l = titleTextLayerFromOverlay(overlay());
    expect(l).toMatchObject({
      type: 'text',
      text: 'Hello',
      fontFamily: 'Inter',
      fontSizePx: 48,
      fontWeight: 700,
      fillColor: '#FFEE00',
      x: 0.5,
      y: 0.8,
      align: 'center',
    });
    // The legacy DOM span's rgba(0,0,0,0.4) box with em-relative padding.
    expect(l.background).toEqual({
      color: '#000000',
      opacity: 0.4,
      paddingXPx: Math.round(0.3 * 48),
      paddingYPx: Math.round(0.1 * 48),
      radiusPx: 0,
    });
  });

  it('picks the align band matching the legacy (w-text_w)*x anchor behavior', () => {
    expect(titleTextLayerFromOverlay(overlay({ x: 0.1 })).align).toBe('left');
    expect(titleTextLayerFromOverlay(overlay({ x: 0.5 })).align).toBe('center');
    expect(titleTextLayerFromOverlay(overlay({ x: 0.9 })).align).toBe('right');
  });

  it('clamps out-of-range values into the contract', () => {
    const l = titleTextLayerFromOverlay(overlay({ x: 1.7, y: -0.2, fontSize: 4 }));
    expect(l.x).toBe(1);
    expect(l.y).toBe(0);
    expect(l.fontSizePx).toBe(8);
  });
});

describe('titleFromTextOverlays', () => {
  it('maps one layer per overlay, drops empty ones, caps at 8, and validates', () => {
    const overlays = [
      overlay({ id: 'a', text: 'One' }),
      overlay({ id: 'b', text: '   ' }), // dropped
      ...Array.from({ length: 10 }, (_, i) => overlay({ id: `x${i}`, text: `T${i}` })),
    ];
    const title = titleFromTextOverlays(overlays);
    expect(title.layers).toHaveLength(8);
    expect(title.layers[0]).toMatchObject({ text: 'One' });
    // The converted title must parse under the real contract schema.
    expect(() => studioTitleSchema.parse(title)).not.toThrow();
  });

  it('produces no layers for all-empty overlays (the store bails then)', () => {
    expect(titleFromTextOverlays([overlay({ text: '' })]).layers).toHaveLength(0);
  });
});
