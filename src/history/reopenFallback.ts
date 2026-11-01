import type { DownloadLink, ConversionJob } from '@/api/schemas/job';
import type { HistoryEntry } from '@/api/schemas/history';
import { canReopen, deadlineOf } from './entryRules';
import { directDownloadForJob, recallEntry } from './entryCache';

/**
 * A `ConversionJob` rebuilt from a History row, for the result screen when `GET /job/:id` answers 404
 * (the in-memory job is gone but the Postgres-backed download still serves). Only the fields the result
 * descriptor reads are meaningful: file name, expiry, metadata flags.
 */
export function jobFromEntry(entry: HistoryEntry): ConversionJob {
  return {
    id: entry.jobId,
    status: 'completed',
    originalFile: { name: '', size: 0, type: '' },
    options: {},
    createdAt: entry.createdAt,
    completedAt: entry.completedAt,
    mode: entry.mode,
    resultFileName: entry.resultFileName,
    expiresAt: deadlineOf(entry),
    metadataAvailable: entry.metadataAvailable,
  };
}

/** The remembered History row for a job id when it can still be opened, else undefined. */
export function reopenableEntry(jobId: string | undefined): HistoryEntry | undefined {
  const e = recallEntry(jobId);
  return e && canReopen(e) ? e : undefined;
}

/**
 * Download-link precedence for a job opened from History: `downloadAbsoluteUrl` > fresh `downloadUrl` >
 * origin + `downloadPath` (all from the remembered row), else the minted `POST /download/:id/link`.
 */
export async function linkForJob(
  jobId: string,
  mint: (jobId: string) => Promise<DownloadLink>,
  now: number = Date.now(),
): Promise<DownloadLink> {
  const direct = directDownloadForJob(jobId, now);
  if (direct) return { url: direct.url, absoluteUrl: direct.url };
  return mint(jobId);
}
