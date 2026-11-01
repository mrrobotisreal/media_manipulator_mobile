import type { HistoryEntry } from '@/api/schemas/history';

/** Web `deadlineOf`: the ledger deadline, falling back to the pre-ledger field. */
export const deadlineOf = (e: HistoryEntry): string | undefined =>
  e.deletesOn || e.resultExpiresAt || undefined;

export const isCompleted = (e: HistoryEntry) => e.status === 'completed';

/** Opens in the result screen: completed and not expired (decision 3/6). */
export const canReopen = (e: HistoryEntry) => isCompleted(e) && !e.expired;

/** Keep longer needs a ledger row (web rule, decision 9). */
export const canKeepLonger = (e: HistoryEntry) => canReopen(e) && Boolean(e.retainedObjectId);

export type RowStatus = 'processing' | 'failed' | null;

export function rowStatus(e: HistoryEntry): RowStatus {
  if (e.status === 'failed') return 'failed';
  if (e.status === 'pending' || e.status === 'processing' || e.status === 'queued')
    return 'processing';
  return null;
}

/** Keep-longer menu (web `KEEP_OPTIONS`). */
export const KEEP_OPTIONS = [
  { id: 'week', hours: 168 },
  { id: 'month', hours: 720 },
  { id: 'sixMonths', hours: 4320 },
  { id: 'year', hours: 8760 },
] as const;
export type KeepOptionId = (typeof KEEP_OPTIONS)[number]['id'];

const DAY_MS = 86_400_000;

/** Port of web `reopenAgeBucket`. */
export function reopenAgeBucket(ageMs: number): '<1d' | '1-7d' | '7-30d' | '30-90d' | '90d+' {
  const days = ageMs / DAY_MS;
  if (!(days >= 1)) return '<1d';
  if (days < 7) return '1-7d';
  if (days < 30) return '7-30d';
  if (days < 90) return '30-90d';
  return '90d+';
}
