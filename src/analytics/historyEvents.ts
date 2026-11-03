import type { HistoryEntry } from '@/api/schemas/history';
import { reopenAgeBucket } from '@/history/entryRules';
import { EVENTS } from './events';
import { track } from './track';

/** Web `retentionEvents.itemReopened`: `kind` is the media kind (else `other`), never a file name or id. */
export function trackHistoryItemReopened(entry: HistoryEntry, now: number = Date.now()): void {
  const created = Date.parse(entry.createdAt);
  if (!Number.isFinite(created)) return;
  track(EVENTS.HISTORY_ITEM_REOPENED, {
    kind: entry.mediaKind || 'other',
    age_bucket: reopenAgeBucket(now - created),
    source: 'account',
  });
}
