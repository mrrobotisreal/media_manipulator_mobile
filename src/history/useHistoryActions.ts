import { router, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { trackHistoryItemReopened } from '@/analytics/historyEvents';
import { historyApi, useKeepJobLongerMutation } from '@/api/endpoints/history';
import type { HistoryEntry } from '@/api/schemas/history';
import { realDeleteDeps } from '@/results/actionDeps';
import { deleteResult } from '@/results/deleteJob';
import { formatDateTime } from '@/lib/format';
import { useAppDispatch } from '@/state/hooks';
import { showNotice } from '@/ui/notice';
import { deleteFlow, keepFlow, type HistoryCache } from './actions';
import type { HistoryData } from './cacheOps';
import { rememberEntry } from './entryCache';
import { apiToolOf } from './toolLabel';
import { canReopen } from './entryRules';

export type HistorySheet =
  | { kind: 'menu'; entry: HistoryEntry }
  | { kind: 'keep'; entry: HistoryEntry }
  | { kind: 'delete'; entry: HistoryEntry };

/** Reopen, delete and keep-longer wiring for the History list. */
export function useHistoryActions(data: HistoryData | undefined) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const [keepJob] = useKeepJobLongerMutation();
  const [sheet, setSheet] = useState<HistorySheet | null>(null);

  const cache: HistoryCache = {
    update: (recipe) => {
      dispatch(historyApi.util.updateQueryData('getHistory', undefined, recipe as never));
    },
  };

  const open = useCallback((entry: HistoryEntry) => {
    if (!canReopen(entry)) return;
    trackHistoryItemReopened(entry);
    rememberEntry(entry);
    router.push(`/(app)/job/${encodeURIComponent(entry.jobId)}?from=history` as Href);
  }, []);

  const confirmDelete = useCallback(
    async (entry: HistoryEntry) => {
      setSheet(null);
      const snapshot = data;
      const outcome = await deleteFlow(entry, snapshot, {
        cache,
        restore: () => void dispatch(historyApi.util.invalidateTags(['History'])),
        remove: (e) =>
          deleteResult(
            e.jobId,
            { jobId: e.jobId, toolSlug: apiToolOf(e) },
            realDeleteDeps(),
          ) as Promise<{ status: 'deleted'; pending: boolean } | { status: 'failed' }>,
      });
      showNotice(
        outcome === 'failed'
          ? t('delete.failed')
          : outcome === 'pending'
            ? t('delete.pending')
            : t('delete.done'),
        outcome === 'failed' ? 'error' : 'info',
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dispatch, data, t],
  );

  const keepLonger = useCallback(
    async (entry: HistoryEntry, hours: number) => {
      setSheet(null);
      const out = await keepFlow(entry, hours, {
        cache,
        keep: (jobId, keepForHours) => keepJob({ jobId, keepForHours }).unwrap(),
      });
      if (out.status === 'kept')
        showNotice(t('history.keep.done', { date: formatDateTime(out.expiresAt, 'date') }));
      else if (out.status === 'gone') showNotice(t('history.keep.gone'), 'error');
      else showNotice(t('history.keep.failed'), 'error');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keepJob, t],
  );

  return { sheet, setSheet, open, confirmDelete, keepLonger };
}
