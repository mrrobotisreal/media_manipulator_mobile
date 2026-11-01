import type { HistoryEntry } from '@/api/schemas/history';
import { KEEP_OPTIONS } from './entryRules';
import { patchInData, removeFromData, type HistoryData } from './cacheOps';

/** What the list does to its cached pages; real impl wraps `updateQueryData`. */
export interface HistoryCache {
  update(recipe: (draft: HistoryData) => void): void;
}

export interface DeleteFlowDeps {
  cache: HistoryCache;
  /** `deleteResult` from MA14 (server delete + local evictions + tag invalidation + `data_deleted`). */
  remove(
    entry: HistoryEntry,
  ): Promise<{ status: 'deleted'; pending: boolean } | { status: 'failed' }>;
  /** Re-reads page 0 after a failure so the restored row is current. */
  restore(): void;
}

/**
 * Optimistic delete (decision 8): the row leaves the cached pages at once; a failure puts the page
 * data back (snapshot) and the caller shows the toast.
 */
export async function deleteFlow(
  entry: HistoryEntry,
  snapshot: HistoryData | undefined,
  deps: DeleteFlowDeps,
): Promise<'deleted' | 'pending' | 'failed'> {
  deps.cache.update((d) => removeFromData(d, entry.jobId));
  const out = await deps.remove(entry);
  if (out.status === 'failed') {
    if (snapshot) deps.cache.update((d) => void Object.assign(d, structuredCopy(snapshot)));
    else deps.restore();
    return 'failed';
  }
  return out.pending ? 'pending' : 'deleted';
}

function structuredCopy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export type KeepOutcome =
  { status: 'kept'; expiresAt: string } | { status: 'gone' } | { status: 'failed' };

export interface KeepFlowDeps {
  cache: HistoryCache;
  /** `PATCH /jobs/:id/retention`; rejects with an `MmError`-shaped `{status, code}`. */
  keep(jobId: string, keepForHours: number): Promise<{ expiresAt: string }>;
}

export const keepHoursFor = (id: (typeof KEEP_OPTIONS)[number]['id']) =>
  KEEP_OPTIONS.find((o) => o.id === id)!.hours;

/** 200 -> row gets `deletesOn = expiresAt`, `keptLonger`; 409 `nothing_to_keep` -> row removed. */
export async function keepFlow(
  entry: HistoryEntry,
  keepForHours: number,
  deps: KeepFlowDeps,
): Promise<KeepOutcome> {
  try {
    const res = await deps.keep(entry.jobId, keepForHours);
    deps.cache.update((d) =>
      patchInData(d, entry.jobId, { deletesOn: res.expiresAt, keptLonger: true }),
    );
    return { status: 'kept', expiresAt: res.expiresAt };
  } catch (e) {
    const err = e as { status?: unknown; code?: unknown } | null;
    if (err?.status === 409 || err?.code === 'nothing_to_keep') {
      deps.cache.update((d) => removeFromData(d, entry.jobId));
      return { status: 'gone' };
    }
    return { status: 'failed' };
  }
}
