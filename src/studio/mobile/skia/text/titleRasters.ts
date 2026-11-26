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
import type { SkImage } from 'react-native-skia';
import { titleRasterKey } from '../../../titleRaster';
import type { StudioTitle, StudioTrack } from '../../../studioTypes';
import { rasterTitleImage, type TitleRasterDeps } from './titleRaster';

export interface TitleRastersDeps extends TitleRasterDeps {
  retire(o: { dispose?: () => void }): void;
}

interface Entry {
  key: string;
  image: SkImage | null;
}

export class TitleRasters {
  private readonly deps: TitleRastersDeps;
  private entries = new Map<string, Entry>();
  /** Rasters made over the cache's lifetime (the tests' "not per frame" probe). */
  rastered = 0;

  constructor(deps: TitleRastersDeps) {
    this.deps = deps;
  }

  /** Brings the cache to the title clips of `tracks` at rasterW x rasterH (project width `projectW`). */
  sync(
    tracks: readonly StudioTrack[],
    rasterW: number,
    rasterH: number,
    projectW: number,
    fontsVersion: number,
  ): void {
    const seen = new Set<string>();
    for (const tr of tracks) {
      if (tr.kind !== 'video') continue;
      for (const c of tr.clips) {
        if (!c.title) continue;
        seen.add(c.id);
        const key = `${fontsVersion}:${titleRasterKey(c.title as StudioTitle, rasterW, rasterH)}`;
        const old = this.entries.get(c.id);
        if (old && old.key === key) continue;
        const image = rasterTitleImage(
          this.deps,
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
    }
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
  }
}
