/**
 * The preview's `PoolMedia` (S1 seam) over the project's bin and the MA61 media cache: a clip's
 * proxy (or reversed proxy) is the cached file; while it is not on the phone the cache fetches it
 * (owner headers, LRU) and `uri()` returns null until it lands, so the pool skips the clip for that
 * tick (`VideoPool.assign`), as for an ingesting clip. Keys are the copied `proxySrcKey`.
 */
import { proxySrcKey } from '../../proxyRebuild';
import { reverseProxyReady } from '../../speed';
import type { StudioAsset, StudioClip } from '../../studioTypes';
import type { PoolMedia, PoolMediaInfo } from '../player/VideoPool';

export interface MediaCacheLike {
  get(asset: Pick<StudioAsset, 'id' | 'mediaKind' | 'proxyGeneration'>, kind: 'proxy' | 'proxyReversed'): Promise<string | null>;
}

export function createPoolMedia(
  assets: () => Record<string, StudioAsset>,
  cache: MediaCacheLike,
  onReady: () => void = () => undefined,
): PoolMedia {
  const ready = new Map<string, string>();
  const pending = new Set<string>();
  const fetch = (asset: StudioAsset, reversed: boolean) => {
    const key = proxySrcKey(asset.id, asset.proxyGeneration, reversed);
    if (ready.has(key) || pending.has(key)) return ready.get(key) ?? null;
    pending.add(key);
    void cache.get(asset, reversed ? 'proxyReversed' : 'proxy').then((uri) => {
      pending.delete(key);
      if (uri) {
        ready.set(key, uri);
        onReady();
      }
    });
    return null;
  };
  return {
    info(clip: StudioClip): PoolMediaInfo | null {
      const asset = assets()[clip.assetId];
      if (!asset || clip.title) return null;
      if (asset.mediaKind !== 'video' && asset.mediaKind !== 'audio') return null; // images: MA63
      if (!asset.s3KeyProxy) return null; // still ingesting: the sprite tile shows
      return {
        kind: asset.mediaKind === 'audio' ? 'audio' : 'video',
        durationSeconds: asset.durationSeconds,
        reverseReady: reverseProxyReady({ asset }),
        fps: asset.fps,
        key: (r) => proxySrcKey(asset.id, asset.proxyGeneration, r),
        uri: (r) => fetch(asset, r),
      };
    },
  };
}
