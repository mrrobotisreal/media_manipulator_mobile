import { useGetJobQuery } from '@/api/endpoints/jobs';
import type { ConversionJob } from '@/api/schemas/job';

export type RemoteJob =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; job: ConversionJob }
  | { status: 'missing' }
  | { status: 'error' };

/**
 * Deep link / History by a server id with no local record: one `GET /job/:id` (owner headers), no
 * polling. 404 (and 401/403, which the API answers for jobs that are not the caller's) -> `missing`.
 */
export function useRemoteJob(jobId: string | undefined, enabled: boolean): RemoteJob {
  const q = useGetJobQuery(jobId ?? '', { skip: !enabled || !jobId });
  if (!enabled || !jobId) return { status: 'idle' };
  if (q.data) return { status: 'ready', job: q.data };
  if (q.error) {
    const status = (q.error as { status?: unknown }).status;
    return status === 404 || status === 401 || status === 403
      ? { status: 'missing' }
      : { status: 'error' };
  }
  return { status: 'loading' };
}
