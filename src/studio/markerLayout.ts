// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/markerLayout.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import type { StudioMarker } from './studioTypes';

/**
 * Markers inside the visible ruler window (plus the selected/edited ones, so a
 * marker being dragged or edited is never unmounted mid-gesture). `markers` is
 * sorted by `t` (the store keeps it so), but this does not rely on that.
 */
export function windowMarkers(
  markers: readonly StudioMarker[],
  startSec: number,
  endSec: number,
  ...keepIds: (string | null)[]
): StudioMarker[] {
  const keep = new Set(keepIds.filter((x): x is string => !!x));
  return markers.filter((m) => (m.t >= startSec && m.t <= endSec) || keep.has(m.id));
}
