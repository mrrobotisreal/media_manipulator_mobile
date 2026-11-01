import type { MmError } from '@/api/errors';
import type { JobRecord } from '@/jobs/types';
import type { RootState } from '@/state/store';
import { quotaMetricForJob } from '@/tools/metric';
import type { QuotaMetric } from '@/tools/types';
import { selectAllowance } from './useAllowance';

/**
 * Decision 6: a known, unexpired, limited allowance at zero refuses locally with the same shape
 * the API's 429 produces, so the job screen and the sheet need no special case. Unknown or
 * unlimited returns null and the upload proceeds (the server stays the authority).
 */
export function quotaRefusal(
  state: RootState,
  metric: QuotaMetric | null,
  now: number = Date.now(),
): MmError | null {
  if (!metric) return null;
  const a = selectAllowance(state, metric, now);
  if (!a || a.unlimited || a.needsRefetch || a.remaining > 0) return null;
  return {
    status: 429,
    code: 'quota_exceeded',
    details: {
      metric,
      limit: a.limit,
      used: a.limit,
      ...(a.resetsAt ? { resetsAt: a.resetsAt } : {}),
      local: true,
    },
  };
}

/** `JobEngineDeps.beforeUpload` (MA12 hook): the metric follows the built options, as the API's. */
export function makeBeforeUpload(getState: () => RootState, now: () => number = Date.now) {
  return async (record: JobRecord): Promise<MmError | null> =>
    quotaRefusal(getState(), quotaMetricForJob(record.options), now());
}
