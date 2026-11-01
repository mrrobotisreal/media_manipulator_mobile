import type { ConversionJob } from '@/api/schemas/job';
import type { MmError } from '@/api/errors';
import { isServerActive, type JobRecord, type LostReason } from './types';

export const LOST_WINDOW_MS = 24 * 60 * 60 * 1000;

/** A 404 for a job accepted < 24 h ago means the in-memory job map was lost (server restart). */
export function lostReasonFor(record: JobRecord, now: number): LostReason {
  return record.acceptedAt !== undefined && now - record.acceptedAt < LOST_WINDOW_MS
    ? 'server_restarted'
    : 'expired';
}

export interface RestoreDeps {
  records(): JobRecord[];
  fetchJob(
    jobId: string,
  ): Promise<{ ok: true; job: ConversionJob } | { ok: false; error: MmError }>;
  apply(localId: string, job: ConversionJob): void;
  markLost(localId: string, reason: LostReason): void;
  now(): number;
}

/**
 * Relaunch restore (decision 13): re-fetch every `pending` / `processing` record once. 200 applies,
 * 404 marks the job lost, any other error leaves the record for the normal tracking loop.
 * Completed records are not re-fetched.
 */
export async function restoreJobs(d: RestoreDeps): Promise<void> {
  const active = d.records().filter((r) => isServerActive(r.state) && r.jobId);
  await Promise.all(
    active.map(async (r) => {
      const res = await d.fetchJob(r.jobId!);
      if (res.ok) d.apply(r.localId, res.job);
      else if (res.error.status === 404) d.markLost(r.localId, lostReasonFor(r, d.now()));
    }),
  );
}
