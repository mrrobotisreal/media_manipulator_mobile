import { File } from 'expo-file-system';
import { track } from '@/analytics/track';
import { API_BASE_URL } from '@/api/config';
import { buildHeaders } from '@/api/baseQuery';
import { linkForJob } from '@/history/reopenFallback';
import type { MmError } from '@/api/errors';
import type { DownloadLink } from '@/api/schemas/job';
import { cachedResult, resultDir, resultFile } from './cache';

export class ResultGoneError extends Error {
  constructor() {
    super('result_gone');
    this.name = 'ResultGoneError';
  }
}

export class ResultFetchError extends Error {
  constructor(
    readonly code: 'network' | 'link' | 'download',
    readonly cause?: unknown,
  ) {
    super(`result_fetch_${code}`);
    this.name = 'ResultFetchError';
  }
}

/** 401/404/410 from the link mint or the download: the result is no longer there for this user. */
const GONE_STATUSES = new Set([401, 403, 404, 410]);

export interface FetchResultDeps {
  /** `POST /download/:jobId/link` (RTK Query, owner headers). Rejects with an `MmError`. */
  mintLink(jobId: string): Promise<DownloadLink>;
  download(
    url: string,
    dest: File,
    opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal },
  ): Promise<void>;
}

export interface FetchResultArgs {
  jobId: string;
  fileName: string;
  sizeBytes?: number;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/** API origin without the `/api` suffix, for the relative-`url` fallback. */
export function apiOrigin(base: string = API_BASE_URL): string {
  try {
    return new URL(base).origin;
  } catch {
    return base.replace(/\/api\/?$/, '');
  }
}

/** `absoluteUrl` (MA08) when present, else the relative `url` against the API origin. */
export function resolveLinkUrl(link: DownloadLink): { url: string; usedFallback: boolean } {
  if (link.absoluteUrl) return { url: link.absoluteUrl, usedFallback: false };
  const rel = link.url.startsWith('/') ? link.url : `/${link.url}`;
  return {
    url: /^https?:/i.test(link.url) ? link.url : `${apiOrigin()}${rel}`,
    usedFallback: true,
  };
}

function isMmError(e: unknown): e is MmError {
  return typeof e === 'object' && e !== null && 'code' in e && 'status' in e;
}

/**
 * Downloads a finished result into `cache/results/<jobId>/<fileName>` (reusing a complete copy).
 * A fresh signed link is minted per download and never stored: it lives 300 s.
 */
export async function fetchResultFile(args: FetchResultArgs, deps: FetchResultDeps): Promise<File> {
  const hit = cachedResult(args.jobId, args.fileName, args.sizeBytes);
  if (hit) return hit;

  // The viewer and Save/Share (MA14) may ask for the same file at once: join the running download
  // instead of racing two writers onto one path. A joiner whose host download was cancelled retries itself.
  const key = resultFile(args.jobId, args.fileName).uri;
  const running = inflight.get(key);
  if (running) {
    try {
      return await running;
    } catch (e) {
      if (args.signal?.aborted || e instanceof ResultGoneError) throw e;
    }
  }
  const own = downloadFresh(args, deps);
  inflight.set(key, own);
  try {
    return await own;
  } finally {
    if (inflight.get(key) === own) inflight.delete(key);
  }
}

const inflight = new Map<string, Promise<File>>();

async function downloadFresh(args: FetchResultArgs, deps: FetchResultDeps): Promise<File> {
  let link: DownloadLink;
  try {
    link = await deps.mintLink(args.jobId);
  } catch (e) {
    if (isMmError(e)) {
      if (typeof e.status === 'number' && GONE_STATUSES.has(e.status)) throw new ResultGoneError();
      throw new ResultFetchError(
        e.code === 'network' || e.code === 'timeout' ? 'network' : 'link',
        e,
      );
    }
    throw new ResultFetchError('link', e);
  }
  const { url, usedFallback } = resolveLinkUrl(link);
  if (usedFallback) {
    track('client_error', {
      message: 'no_absolute_url',
      stage: 'download_link',
      error_type: 'no_absolute_url',
      source: 'manual',
    });
  }

  const dir = resultDir(args.jobId);
  const dest = resultFile(args.jobId, args.fileName);
  try {
    dir.create({ intermediates: true, idempotent: true });
    await deps.download(url, dest, { onProgress: args.onProgress, signal: args.signal });
  } catch (e) {
    try {
      if (dest.exists) dest.delete();
    } catch {
      // best effort
    }
    const status = (e as { status?: number } | undefined)?.status;
    if (typeof status === 'number' && GONE_STATUSES.has(status)) throw new ResultGoneError();
    throw new ResultFetchError('download', e);
  }
  return dest;
}

/**
 * Streaming URL for video/audio (`GET /api/result/:jobId`, Range-capable, owner headers or `?sid=`).
 * Used only when the API reported a sniffed MIME (`mimeFromServer`), else download first.
 */
export function inlineResultUrl(jobId: string, sessionId: string): string {
  return `${API_BASE_URL}/result/${encodeURIComponent(jobId)}?sid=${encodeURIComponent(sessionId)}`;
}

/** API-hosted download URL without a signed `token=`: needs the owner headers. */
function isTokenless(url: string): boolean {
  return url.startsWith(`${apiOrigin()}/`) && !/[?&]token=/.test(url);
}

/** Real dependencies: RTK Query mint + `File.downloadFileAsync`. Imported lazily so tests stay native-free. */
export function realFetchDeps(): FetchResultDeps {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { store } = require('@/state/store') as typeof import('@/state/store');
  const { jobsApi } = require('@/api/endpoints/jobs') as typeof import('@/api/endpoints/jobs');
  /* eslint-enable @typescript-eslint/no-require-imports */
  return {
    // A job opened from History may carry a direct URL (MA15); otherwise a link is minted.
    mintLink: (jobId) =>
      linkForJob(
        jobId,
        (id) =>
          store
            .dispatch(jobsApi.endpoints.createDownloadLink.initiate(id))
            .unwrap() as Promise<DownloadLink>,
      ),
    download: async (url, dest, { onProgress, signal }) => {
      // A History URL on the API host has no token: it is authorised by the owner headers.
      const headers = isTokenless(url) ? await buildHeaders() : undefined;
      await File.downloadFileAsync(url, dest, {
        idempotent: true,
        signal,
        headers,
        onProgress: ({ bytesWritten, totalBytes }) => {
          if (onProgress && totalBytes > 0) onProgress(Math.min(1, bytesWritten / totalBytes));
        },
      });
    },
  };
}
