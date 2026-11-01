import type { ResultContext } from '@/analytics/resultEvents';
import { trackItemDeleted } from '@/analytics/saveEvents';
import type { DeletedJob } from '@/api/schemas/job';

export interface DeleteDeps {
  /** `DELETE /jobs/:id` */
  remove(jobId: string): Promise<DeletedJob>;
  evictResult(jobId: string): void;
  evictOriginal(jobId: string): void;
  /** Drops the local record from the `jobs` slice (no-op when there is none). */
  removeRecord(jobId: string): void;
  /** Invalidates the `History` and `Account` tags. */
  invalidate(): void;
}

export type DeleteOutcome =
  { status: 'deleted'; pending: boolean } | { status: 'failed'; httpStatus?: number };

/**
 * Deletes a result on the server and locally. 404 means it is already gone and counts as success (the local
 * copies still go). `pending > 0` means the server is still sweeping the files. `data_deleted` fires once.
 */
export async function deleteResult(
  jobId: string,
  context: ResultContext,
  deps: DeleteDeps,
): Promise<DeleteOutcome> {
  let pending = false;
  try {
    const res = await deps.remove(jobId);
    pending = (res.pending ?? 0) > 0;
  } catch (e) {
    const status = (e as { status?: unknown } | null)?.status;
    if (status !== 404)
      return { status: 'failed', httpStatus: typeof status === 'number' ? status : undefined };
  }
  deps.evictResult(jobId);
  deps.evictOriginal(jobId);
  deps.removeRecord(jobId);
  deps.invalidate();
  trackItemDeleted(context);
  return { status: 'deleted', pending };
}
