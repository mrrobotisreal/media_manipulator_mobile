// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/timelineWindow.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import { clipDuration, clipEnd } from './previewEngine';
import type { StudioClip } from './studioTypes';

/**
 * Timeline windowing math (part 11). Pure functions — no React, no DOM — so the
 * virtualization contract ("the DOM holds O(visible) clips, not O(total)") is
 * unit-testable against a 1,000-clip fixture without a browser.
 *
 * The timeline renders only clips intersecting the visible scroll window plus
 * one viewport of overscan on each side. Clips being dragged or selected are
 * always kept (dnd-kit must never have its active node unmounted mid-drag, and
 * trim handles target the selection).
 */

/** Visible time range, in timeline seconds. */
export interface VisibleWindow {
  startSec: number;
  endSec: number;
}

/** One clip the timeline should mount, with its resolved track-local geometry. */
export interface WindowedClip {
  clip: StudioClip;
  /** px from the track's left edge. */
  left: number;
  /** px, floored at 8 so zero-width clips stay grabbable. */
  width: number;
}

/** Minimum rendered clip width in px (mirrors the pre-virtualization timeline). */
export const MIN_CLIP_PX = 8;

/** Overscan: this many extra viewports are rendered on each side of the view. */
export const OVERSCAN_VIEWPORTS = 1;

/**
 * Quantize scrollLeft to half-viewport steps. The scroll handler re-renders the
 * timeline only when the quantized value changes — every half viewport — and
 * the overscan margin (a full viewport) absorbs the quantization error, so
 * clips are always mounted before they scroll into view.
 */
export function quantizeScrollLeft(scrollLeft: number, viewportWidth: number): number {
  const chunk = Math.max(64, viewportWidth / 2);
  return Math.floor(Math.max(0, scrollLeft) / chunk) * chunk;
}

/**
 * The time range worth mounting for a given scroll position. A non-positive
 * viewport width means "not measured yet" (first paint, jsdom): everything is
 * visible, which is always correct, just not yet bounded.
 */
export function visibleWindow(
  scrollLeft: number,
  viewportWidth: number,
  zoom: number,
  overscanViewports: number = OVERSCAN_VIEWPORTS,
): VisibleWindow {
  if (viewportWidth <= 0) return { startSec: 0, endSec: Number.POSITIVE_INFINITY };
  const pxPerSec = Math.max(zoom, 1e-6);
  const overscanPx = viewportWidth * overscanViewports;
  return {
    startSec: Math.max(0, (scrollLeft - overscanPx) / pxPerSec),
    endSec: (scrollLeft + viewportWidth + overscanPx) / pxPerSec,
  };
}

/**
 * The clips a track lane should mount: those intersecting the window, plus any
 * whose id is in `keepIds` regardless of position. Output preserves the input
 * order (stacking/paint order must not change with scroll).
 */
export function windowClips(
  clips: readonly StudioClip[],
  win: VisibleWindow,
  zoom: number,
  keepIds?: ReadonlySet<string>,
): WindowedClip[] {
  const out: WindowedClip[] = [];
  for (const clip of clips) {
    const start = clip.timelineStart;
    const end = clipEnd(clip);
    const intersects = end >= win.startSec && start <= win.endSec;
    if (!intersects && !keepIds?.has(clip.id)) continue;
    out.push({
      clip,
      left: start * zoom,
      width: Math.max(MIN_CLIP_PX, clipDuration(clip) * zoom),
    });
  }
  return out;
}

/**
 * Inclusive tick-index range for the ruler: only ticks inside the window are
 * rendered. `count` is the total tick count for the full timeline length.
 */
export function windowTickRange(
  win: VisibleWindow,
  stepSec: number,
  count: number,
): { first: number; last: number } {
  const step = Math.max(stepSec, 1e-6);
  const first = Math.max(0, Math.floor(win.startSec / step));
  const last = Number.isFinite(win.endSec)
    ? Math.min(count - 1, Math.ceil(win.endSec / step))
    : count - 1;
  return { first, last };
}
