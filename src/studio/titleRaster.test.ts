// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/titleRaster.test.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import { describe, expect, it } from 'vitest';
import { layoutTitleText, lineExtent, titleFontString, titleRasterKey } from './titleRaster';
import type { StudioTitle, StudioTitleTextLayer } from './studioTypes';

// Pure layout math for the title raster (part 16). The same numbers are
// asserted on the Go side against titleLayerParts' drawtext x/y expressions
// (TestBuildExportArgs_TitleClipChain) — the SHARED TITLE LAYOUT SPEC.

const textLayer = (over: Partial<StudioTitleTextLayer> = {}): StudioTitleTextLayer => ({
  type: 'text',
  text: 'Title',
  fontFamily: 'Inter',
  fontSizePx: 64,
  fontWeight: 700,
  fillColor: '#FFFFFF',
  align: 'center',
  x: 0.5,
  y: 0.5,
  ...over,
});

// A deterministic fake measurer: 10px per character.
const measure = (line: string) => line.length * 10;

describe('layoutTitleText', () => {
  it('centers a two-line block on the anchor (the Go golden numbers)', () => {
    // Mirrors TestBuildExportArgs_TitleClipChain: 1920×1080, 64px, lineHeight
    // 1.25 → lineH 80, blockH 160, line centers at 500 and 580.
    const layout = layoutTitleText(
      textLayer({ text: 'Hello\nWorld', lineHeight: 1.25 }),
      1920,
      1080,
      1,
      measure,
    );
    expect(layout.lineHeightPx).toBe(80);
    expect(layout.blockHeightPx).toBe(160);
    expect(layout.lines.map((l) => l.centerYPx)).toEqual([500, 580]);
    expect(layout.lines.every((l) => l.anchorXPx === 960)).toBe(true);
  });

  it('defaults lineHeight to 1.2 and keeps a single line centered on the anchor', () => {
    const layout = layoutTitleText(textLayer({ text: 'One' }), 1000, 1000, 1, measure);
    expect(layout.lineHeightPx).toBeCloseTo(76.8);
    expect(layout.lines).toHaveLength(1);
    expect(layout.lines[0].centerYPx).toBeCloseTo(500);
    expect(layout.lines[0].widthPx).toBe(30);
  });

  it('scales pixel fields by the raster factor k', () => {
    const layout = layoutTitleText(textLayer({ text: 'Hi', lineHeight: 1 }), 960, 540, 0.5, measure);
    expect(layout.fontPx).toBe(32);
    expect(layout.lineHeightPx).toBe(32);
  });

  it('preserves empty lines as vertical space without measuring them', () => {
    const layout = layoutTitleText(textLayer({ text: 'A\n\nB', lineHeight: 1 }), 100, 300, 1, measure);
    expect(layout.lines).toHaveLength(3);
    expect(layout.lines[1].widthPx).toBe(0);
    expect(layout.blockHeightPx).toBe(3 * 64);
  });

  it('clamps bold away for 400-only families (no synthetic canvas bold)', () => {
    const layout = layoutTitleText(
      textLayer({ fontFamily: 'Bebas Neue', fontWeight: 700 }),
      100,
      100,
      1,
      measure,
    );
    expect(layout.fontWeight).toBe(400);
    expect(titleFontString(textLayer({ fontFamily: 'Bebas Neue', fontWeight: 700 }), 1)).toContain('400 ');
  });

  it('resolves unknown families to the default before layout', () => {
    const layout = layoutTitleText(textLayer({ fontFamily: 'Comic Sans MS' }), 100, 100, 1, measure);
    expect(layout.fontFamily).toBe('Inter');
  });
});

describe('lineExtent (background plate box math)', () => {
  it('hangs the line off the anchor per align, like drawtext x expressions', () => {
    expect(lineExtent('left', 100, 50)).toEqual({ left: 100, right: 150 });
    expect(lineExtent('center', 100, 50)).toEqual({ left: 75, right: 125 });
    expect(lineExtent('right', 100, 50)).toEqual({ left: 50, right: 100 });
  });
});

describe('titleRasterKey', () => {
  const title: StudioTitle = { layers: [textLayer()] };

  it('changes with content and raster size, stable otherwise', () => {
    const a = titleRasterKey(title, 640, 360);
    expect(titleRasterKey(title, 640, 360)).toBe(a);
    expect(titleRasterKey(title, 320, 180)).not.toBe(a);
    expect(titleRasterKey({ layers: [textLayer({ text: 'Other' })] }, 640, 360)).not.toBe(a);
  });
});
