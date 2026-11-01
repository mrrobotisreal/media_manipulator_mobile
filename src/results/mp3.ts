import type { ResultContext } from '@/analytics/resultEvents';
import { trackDownloadFailed, trackDownloadStarted } from '@/analytics/saveEvents';
import type { DownloadLink, Mp3Status } from '@/api/schemas/job';
import { extensionOf } from './describe';

/** Poll cadence while the server encodes, and the give-up point (the encode keeps going server-side). */
export const MP3_POLL_MS = 2000;
export const MP3_POLL_TIMEOUT_MS = 20 * 60 * 1000;

const VOCAL_STEM_HINTS = new Set([
  'isolate-vocals',
  'remove-vocals',
  'isolate_vocals',
  'remove_vocals',
  'ai_isolate_vocals',
  'ai_remove_vocals',
  'isolate-vocals-from-song',
  'remove-vocals-from-song',
]);

/**
 * The MP3 offer condition (MA14 decision 6, chosen): a `.wav` result of a vocal-stem tool, as the web's
 * `isVocalStemJob && canDownloadAsMp3`. The API accepts any WAV result; offering it everywhere is the
 * documented alternative. `hints` are the tool id, web task and analytics slug the surface knows.
 */
export function canOfferMp3(
  fileName: string | undefined,
  ...hints: (string | null | undefined)[]
): boolean {
  if (extensionOf(fileName) !== 'wav') return false;
  return hints.some((h) => VOCAL_STEM_HINTS.has((h ?? '').trim().toLowerCase()));
}

/** `My Song_converted.wav` -> `My Song_converted.mp3`. */
export function mp3NameFor(fileName: string): string {
  const base = fileName.replace(/\.[^.]*$/, '') || 'converted';
  return `${base}.mp3`;
}

export interface Mp3Deps {
  /** `POST /download/:id/mp3` */
  start(jobId: string): Promise<Mp3Status>;
  /** `GET /download/:id/mp3` */
  poll(jobId: string): Promise<Mp3Status>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export type Mp3Outcome =
  | { status: 'ready'; link: DownloadLink; fileName: string; sizeBytes?: number }
  | { status: 'timeout' }
  | { status: 'failed'; httpStatus?: number }
  | { status: 'skipped' };

const running = new Set<string>();

/**
 * Starts (or joins) the MP3 transcode and waits for the signed link. `download_started {output_format:'mp3'}`
 * fires at the first POST (web parity); conversion failures fire `download_failed`. The caller then downloads
 * `link` with `downloadResult({link, skipStartedEvent: true})`, which emits `download_completed`.
 */
export async function convertToMp3(
  jobId: string,
  wavName: string,
  context: ResultContext,
  deps: Mp3Deps,
): Promise<Mp3Outcome> {
  if (running.has(jobId)) return { status: 'skipped' };
  running.add(jobId);
  trackDownloadStarted(context, 'mp3');
  const fail = (reason: string, httpStatus?: number): Mp3Outcome => {
    trackDownloadFailed(context, reason, httpStatus);
    return reason === 'timeout' ? { status: 'timeout' } : { status: 'failed', httpStatus };
  };
  try {
    let res = await deps.start(jobId);
    const deadline = deps.now() + MP3_POLL_TIMEOUT_MS;
    while (res.status === 'processing') {
      if (deps.now() > deadline) return fail('timeout');
      await deps.sleep(MP3_POLL_MS);
      res = await deps.poll(jobId);
    }
    if (res.status !== 'ready' || !res.url) return fail('mp3_failed');
    return {
      status: 'ready',
      link: { url: res.url, absoluteUrl: res.absoluteUrl, sizeBytes: res.sizeBytes },
      fileName: res.fileName || mp3NameFor(wavName),
      sizeBytes: res.sizeBytes,
    };
  } catch (e) {
    const status = (e as { status?: unknown } | null)?.status;
    return fail('mp3_failed', typeof status === 'number' ? status : undefined);
  } finally {
    running.delete(jobId);
  }
}
