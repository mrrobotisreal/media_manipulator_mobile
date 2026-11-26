/**
 * The title clips' rasters (MA62 decision 8), the phone's version of the web's `titleRasterCache`
 * (preview-surface.tsx): one image per title clip, re-rastered only when its key changes, the key
 * being the web's own `titleRasterKey(title, w, h)` prefixed with the fonts version (the web's
 * `fontsVersionRef`: a family arriving re-rasters titles that fell back).
 *
 * `sync()` runs when the document, the backing size or the fonts change, never per frame (the key
 * is a JSON string of the layers). A replaced or removed image is retired through the compositor
 * (`retire`), which disposes it `RETIRE_FRAMES` frames later: the canvas may still draw it.
 */
import type { SkImage, SkSurface } from 'react-native-skia';
import { clipEnd } from '../../../previewEngine';
import { titleRasterKey } from '../../../titleRaster';
import type { StudioTitle, StudioTrack } from '../../../studioTypes';
import { RasterSurface, rasterTitleImage, type TitleRasterDeps } from './titleRaster';

export interface TitleRastersDeps extends Omit<TitleRasterDeps, 'surface'> {
  makeSurface(w: number, h: number): SkSurface | null;
  retire(o: { dispose?: () => void }): void;
}

/** Title clips rastered around the playhead (s): the web rasters the active ones; the phone also pre-rasters the next. */
export const TITLE_WINDOW_BEFORE_S = 1;
export const TITLE_WINDOW_AFTER_S = 3;

interface Entry {
  key: string;
  image: SkImage | null;
}

export class TitleRasters {
  private readonly deps: TitleRastersDeps;
  private readonly surface: RasterSurface;
  private entries = new Map<string, Entry>();
  /** Rasters made over the cache's lifetime (the tests' "not per frame" probe). */
  rastered = 0;

  constructor(deps: TitleRastersDeps) {
    this.deps = deps;
    this.surface = new RasterSurface(deps.makeSurface);
  }

  /**
   * Brings the cache to the title clips of `tracks` at rasterW x rasterH (project width `projectW`)
   * that overlap the window around `t` (all of them when `t` is undefined). Clips outside it are
   * released, so the GPU memory held is bounded by what is near the playhead.
   */
  sync(
    tracks: readonly StudioTrack[],
    rasterW: number,
    rasterH: number,
    projectW: number,
    fontsVersion: number,
    t?: number,
  ): boolean {
    const seen = new Set<string>();
    let changed = false;
    for (const tr of tracks) {
      if (tr.kind !== 'video') continue;
      for (const c of tr.clips) {
        if (!c.title) continue;
        if (t !== undefined && (clipEnd(c) < t - TITLE_WINDOW_BEFORE_S || c.timelineStart > t + TITLE_WINDOW_AFTER_S)) continue;
        seen.add(c.id);
        const key = `${fontsVersion}:${titleRasterKey(c.title as StudioTitle, rasterW, rasterH)}`;
        const old = this.entries.get(c.id);
        if (old && old.key === key) continue;
        changed = true;
        const image = rasterTitleImage(
          { ...this.deps, surface: (w, h) => this.surface.get(w, h) },
          c.title as StudioTitle,
          rasterW,
          rasterH,
          projectW,
        );
        this.rastered += 1;
        if (old?.image) this.deps.retire(old.image);
        this.entries.set(c.id, { key, image });
      }
    }
    for (const [id, e] of this.entries) {
      if (seen.has(id)) continue;
      if (e.image) this.deps.retire(e.image);
      this.entries.delete(id);
      changed = true;
    }
    return changed;
  }

  /** clip id -> image, for the frame loop (rebuilt only when `sync` changed something). */
  images(): Record<string, SkImage> {
    const out: Record<string, SkImage> = {};
    for (const [id, e] of this.entries) if (e.image) out[id] = e.image;
    return out;
  }

  image(clipId: string): SkImage | null {
    return this.entries.get(clipId)?.image ?? null;
  }

  /** Disposes every raster now (unmount: nothing draws any more). */
  dispose(): void {
    for (const e of this.entries.values()) {
      try {
        e.image?.dispose();
      } catch {
        // already disposed
      }
    }
    this.entries.clear();
    this.surface.dispose();
  }
}
