/**
 * Native bindings for `assets.ts` (MA61): the media cache on expo-file-system, the MA12 upload task,
 * the connection type from expo-network, and the API calls on the app's RTK Query store. Kept apart
 * from the pure module so its jest suite never loads native code; the editor (MA63) uses these.
 */
import { Directory, File, Paths } from 'expo-file-system';
import * as Network from 'expo-network';
import { Platform } from 'react-native';
import { connectionTypeOf } from '@/analytics/context';
import { buildHeaders } from '@/api/baseQuery';
import { jobsApi } from '@/api/endpoints/jobs';
import { makeUploadTask } from '@/jobs/fsTask';
import type { AppDispatch } from '@/state/store';
import {
  createStudioMediaCache,
  type CacheEntryInfo,
  type ConnectionKind,
  type IngestPollDeps,
  type StudioCacheFs,
  type StudioUploadDeps,
} from './assets';
import { studioSessionApiFor } from './sessionApi';

/** `Paths.cache/studio/<assetId>/`: proxies, sprites and peaks (LRU, 256 MB). */
export const STUDIO_CACHE_DIR = 'studio';

const root = () => new Directory(Paths.cache, STUDIO_CACHE_DIR);
const fileAt = (path: string) => {
  const [dir, name] = path.split('/') as [string, string];
  return new File(new Directory(root(), dir), name);
};

export const studioCacheFs: StudioCacheFs = {
  list() {
    const out: CacheEntryInfo[] = [];
    try {
      const base = root();
      if (!base.exists) return out;
      for (const d of base.list()) {
        if (!(d instanceof Directory)) continue;
        for (const f of d.list()) {
          if (!(f instanceof File)) continue;
          const info = f.info();
          out.push({
            path: `${d.name}/${f.name}`,
            size: info.size ?? 0,
            mtime: info.modificationTime ?? info.creationTime ?? 0,
          });
        }
      }
    } catch {
      // best effort: an unreadable cache is an empty one
    }
    return out;
  },
  uri: (path) => fileAt(path).uri,
  exists(path) {
    try {
      const f = fileAt(path);
      return f.exists && f.size > 0;
    } catch {
      return false;
    }
  },
  remove(path) {
    const f = fileAt(path);
    if (f.exists) f.delete();
  },
  async download(url, path, headers) {
    const f = fileAt(path);
    new Directory(root(), path.split('/')[0]!).create({ intermediates: true, idempotent: true });
    const out = await File.downloadFileAsync(url, f, { headers, idempotent: true });
    return out.size;
  },
};

/** The one media cache instance (owner headers from `buildHeaders()`, never in the URL). */
export const studioMediaCache = createStudioMediaCache({
  fs: studioCacheFs,
  headers: () => buildHeaders(),
  now: () => Date.now(),
});

export async function currentConnection(): Promise<ConnectionKind> {
  try {
    return connectionTypeOf((await Network.getNetworkStateAsync()).type);
  } catch {
    return 'unknown';
  }
}

export function studioUploadDepsFor(dispatch: AppDispatch): StudioUploadDeps {
  const api = studioSessionApiFor(dispatch as never);
  return {
    presign: api.presign,
    complete: api.complete,
    makeTask: makeUploadTask,
    platform: Platform.OS,
    now: () => Date.now(),
  };
}

export function ingestPollDepsFor(dispatch: AppDispatch): IngestPollDeps {
  const api = studioSessionApiFor(dispatch as never);
  return {
    listAssets: api.listAssets,
    async jobStatus(jobId) {
      const pending = dispatch(jobsApi.endpoints.getJob.initiate(jobId, { forceRefetch: true }));
      try {
        const r = await pending;
        return r.data?.status ?? null;
      } finally {
        pending.unsubscribe();
      }
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
  };
}
