// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/titleConvert.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import type { StudioTextOverlay, StudioTitle, StudioTitleTextLayer } from './studioTypes';
import { DEFAULT_TITLE_FONT_FAMILY } from './titleFonts';

/**
 * Legacy `textOverlays` → title-clip conversion (part 16). Pure so the mapping
 * is unit-testable; the store action wraps it in one undo entry.
 *
 * Positioning: a legacy overlay anchors like drawtext's `(w-text_w)*x` — the
 * box's LEFT edge sits at x·w when x=0, its RIGHT edge at w when x=1, centered
 * at x=0.5. The title contract anchors a block off (x, y) via `align`, so the
 * closest faithful mapping picks the align whose anchor behavior matches the
 * overlay's position band; mid-frame overlays (the common case) convert
 * exactly, edge-hugging ones land within a text-width of the original.
 */

const MAX_LAYERS = 8;

function alignFor(x: number): StudioTitleTextLayer['align'] {
  if (x < 0.33) return 'left';
  if (x > 0.67) return 'right';
  return 'center';
}

export function titleTextLayerFromOverlay(ov: StudioTextOverlay): StudioTitleTextLayer {
  return {
    type: 'text',
    text: ov.text,
    fontFamily: DEFAULT_TITLE_FONT_FAMILY,
    fontSizePx: Math.max(8, Math.min(500, ov.fontSize)),
    // Legacy overlays render weight 600; 700 is the closest shipped weight.
    fontWeight: 700,
    fillColor: ov.color,
    // The legacy DOM span draws rgba(0,0,0,0.4) with 0.1em/0.3em padding.
    background: {
      color: '#000000',
      opacity: 0.4,
      paddingXPx: Math.round(0.3 * ov.fontSize),
      paddingYPx: Math.round(0.1 * ov.fontSize),
      radiusPx: 0,
    },
    align: alignFor(ov.x),
    x: Math.max(0, Math.min(1, ov.x)),
    y: Math.max(0, Math.min(1, ov.y)),
  };
}

/** Builds the equivalent title (one text layer per overlay, capped at 8). */
export function titleFromTextOverlays(overlays: StudioTextOverlay[]): StudioTitle {
  return {
    layers: overlays
      .filter((ov) => ov.text.trim() !== '')
      .slice(0, MAX_LAYERS)
      .map(titleTextLayerFromOverlay),
  };
}
