import type { HistoryEntry, HistoryPage } from '@/api/schemas/history';
import { isHiddenInHistory } from './toolLabel';

/** The shape RTK Query keeps for an infinite query. */
export interface HistoryData {
  pages: HistoryPage[];
  pageParams: number[];
}

/**
 * Every loaded row, in server order, de-duplicated by `jobId` (offset paging can repeat a row when
 * new jobs land), without the internal steps (`photo_heal`, MA52).
 */
export function flattenHistory(data: HistoryData | undefined): HistoryEntry[] {
  if (!data) return [];
  const seen = new Set<string>();
  const out: HistoryEntry[] = [];
  for (const page of data.pages)
    for (const e of page.entries) {
      if (seen.has(e.jobId) || isHiddenInHistory(e)) continue;
      seen.add(e.jobId);
      out.push(e);
    }
  return out;
}

/** The server total, from the newest page. */
export function historyTotal(data: HistoryData | undefined): number {
  const last = data?.pages[data.pages.length - 1];
  return last?.total ?? 0;
}

/** Immer-style: drops a row from every cached page. */
export function removeFromData(draft: HistoryData, jobId: string): void {
  for (const page of draft.pages) {
    const before = page.entries.length;
    page.entries = page.entries.filter((e) => e.jobId !== jobId);
    if (page.entries.length !== before) page.total = Math.max(0, page.total - 1);
  }
}

/** Immer-style: merges fields into the matching row. */
export function patchInData(draft: HistoryData, jobId: string, patch: Partial<HistoryEntry>): void {
  for (const page of draft.pages)
    for (const e of page.entries) if (e.jobId === jobId) Object.assign(e, patch);
}
