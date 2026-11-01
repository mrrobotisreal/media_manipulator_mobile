import type { File } from 'expo-file-system';
import {
  trackDownloadCompleted,
  trackDownloadFailed,
  trackDownloadStarted,
} from '@/analytics/saveEvents';
import type { ResultContext } from '@/analytics/resultEvents';
import type { DownloadLink } from '@/api/schemas/job';
import { cachedResult } from '@/results/cache';
import {
  fetchResultFile,
  realFetchDeps,
  ResultFetchError,
  ResultGoneError,
  type FetchResultDeps,
} from '@/results/fetchResult';

export interface DownloadResultArgs {
  jobId: string;
  fileName: string;
  sizeBytes?: number;
  /** Catalog `output_format` (the result's extension, `mp3` for the MP3 variant). */
  outputFormat: string;
  context: ResultContext;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  /** A link already minted by a variant flow (MP3). Omitted: the plain `POST /download/:id/link`. */
  link?: DownloadLink;
  /** The MP3 flow already emitted `download_started` at its first POST. */
  skipStartedEvent?: boolean;
  deps?: FetchResultDeps;
  now?: () => number;
}

/** `download_failed.reason`: a closed set, never an error message. */
export type DownloadFailReason = 'gone' | 'network' | 'link' | 'download';

/**
 * Downloads a result into `cache/results/<jobId>/` for Save/Share (MA14), reusing MA13's
 * `fetchResultFile` (signed `absoluteUrl`, owner headers on the mint, a cancellable transfer). A cached
 * copy is returned with no network and no `download_started`. The signed link is minted per call.
 */
export async function downloadResult(args: DownloadResultArgs): Promise<File> {
  const cached = cachedResult(args.jobId, args.fileName, args.sizeBytes);
  if (cached) return cached;

  const now = args.now ?? Date.now;
  const base = args.deps ?? realFetchDeps();
  const deps: FetchResultDeps = args.link
    ? { ...base, mintLink: async () => args.link as DownloadLink }
    : base;
  const started = now();
  if (!args.skipStartedEvent) trackDownloadStarted(args.context, args.outputFormat, args.sizeBytes);
  try {
    const file = await fetchResultFile(
      {
        jobId: args.jobId,
        fileName: args.fileName,
        sizeBytes: args.sizeBytes,
        onProgress: args.onProgress,
        signal: args.signal,
      },
      deps,
    );
    trackDownloadCompleted(args.context, args.outputFormat, file.size, now() - started);
    return file;
  } catch (e) {
    if (!args.signal?.aborted) {
      if (e instanceof ResultGoneError) trackDownloadFailed(args.context, 'gone', 404);
      else if (e instanceof ResultFetchError) {
        const status = (e.cause as { status?: number } | undefined)?.status;
        trackDownloadFailed(args.context, e.code, typeof status === 'number' ? status : undefined);
      } else trackDownloadFailed(args.context, 'download');
    }
    throw e;
  }
}

export { ResultFetchError, ResultGoneError };
