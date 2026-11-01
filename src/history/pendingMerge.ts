import type { JobRecord, JobState } from '@/jobs/types';

/** States shown in "In progress" (decision 5); `cancelled | stopped | lost` and terminal states are not. */
export const PENDING_STATES: ReadonlySet<JobState> = new Set<JobState>([
  'queued',
  'uploading',
  'finalizing',
  'pending',
  'processing',
  'upload_failed',
]);

/**
 * Local records the server history does not list yet, newest first. Once a loaded page contains the
 * record's `jobId` the server row wins and the record drops out of this list.
 */
export function pendingRecords(
  records: readonly JobRecord[],
  serverJobIds: ReadonlySet<string>,
): JobRecord[] {
  return records
    .filter((r) => PENDING_STATES.has(r.state) && !(r.jobId && serverJobIds.has(r.jobId)))
    .sort((a, b) => b.createdAt - a.createdAt);
}
