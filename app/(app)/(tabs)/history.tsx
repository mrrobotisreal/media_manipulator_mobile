import { useFocusEffect, router, type Href } from 'expo-router';
import { History } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, RefreshControl, SectionList, View } from 'react-native';
import { useGetHistoryInfiniteQuery } from '@/api/endpoints/history';
import { useGetAccountMeQuery } from '@/api/hooks';
import type { HistoryEntry } from '@/api/schemas/history';
import { flattenHistory, type HistoryData } from '@/history/cacheOps';
import { groupByDay } from '@/history/groupByDay';
import { HistoryRow } from '@/history/HistoryRow';
import { HistorySheets } from '@/history/HistorySheets';
import { PendingRow } from '@/history/PendingRow';
import { pendingRecords } from '@/history/pendingMerge';
import { useHistoryActions } from '@/history/useHistoryActions';
import { formatDateTime, formatRetention } from '@/lib/format';
import { useAppSelector } from '@/state/hooks';
import { ProjectsList } from '@/photo/ui/ProjectsList';
import { useGetPhotoCapabilitiesQuery } from '@/photo/projectsApi';
import { Button } from '@/ui/components/Button';
import { EmptyState } from '@/ui/components/EmptyState';
import { Screen } from '@/ui/components/Screen';
import { Segmented } from '@/ui/components/Segmented';
import { Text } from '@/ui/components/Text';
import { colors } from '@/ui/tokens';

const STALE_MS = 60_000;
const TOOLS_TAB = '/(app)/(tabs)' as Href;

type Row = { type: 'entry'; entry: HistoryEntry } | { type: 'pending'; localId: string };

type Segment = 'jobs' | 'projects';

/**
 * History (MA15) with MA52's "Jobs · Projects" segmented control: Projects lists the Aperture
 * projects. The control is shown while Aperture is available (`GET /photo/capabilities` enabled,
 * or not known yet), like the Tools-tab row.
 */
export default function HistoryTab() {
  const { t } = useTranslation();
  const caps = useGetPhotoCapabilitiesQuery();
  const photo = !caps.data || caps.data.enabled;
  const [segment, setSegment] = useState<Segment>('jobs');
  const seg: Segment = photo ? segment : 'jobs';
  const segments = photo ? (
    <View className="px-4 pb-2">
      <Segmented
        options={[
          { value: 'jobs', label: t('history.segments.jobs') },
          { value: 'projects', label: t('history.segments.projects') },
        ]}
        value={seg}
        onChange={setSegment}
      />
    </View>
  ) : null;
  return seg === 'projects' ? (
    <Screen edges="none">
      <Text className="px-4 pb-2 pt-3 text-xl font-semibold">{t('history.title')}</Text>
      {segments}
      <ProjectsList onOpenTools={() => router.navigate(TOOLS_TAB)} />
    </Screen>
  ) : (
    <JobsHistory segments={segments} />
  );
}

function JobsHistory({ segments }: { segments: React.ReactNode }) {
  const { t } = useTranslation();
  const q = useGetHistoryInfiniteQuery(undefined);
  const me = useGetAccountMeQuery();
  const jobs = useAppSelector((s) => s.jobs);
  const lastFetch = useRef(0);
  const actions = useHistoryActions(q.data as HistoryData | undefined);
  const fulfilledAt = q.fulfilledTimeStamp ?? 0;
  useEffect(() => {
    lastFetch.current = fulfilledAt;
  }, [fulfilledAt]);

  const entries = useMemo(() => flattenHistory(q.data as HistoryData | undefined), [q.data]);
  const pending = useMemo(
    () =>
      pendingRecords(
        jobs.order
          .map((id) => jobs.byLocalId[id])
          .filter((r): r is NonNullable<typeof r> => Boolean(r)),
        new Set(entries.map((e) => e.jobId)),
      ),
    [jobs, entries],
  );
  const sections = useMemo(() => {
    const out: { key: string; title: string; data: Row[] }[] = [];
    if (pending.length)
      out.push({
        key: 'pending',
        title: t('history.inProgress'),
        data: pending.map((r) => ({ type: 'pending' as const, localId: r.localId })),
      });
    for (const s of groupByDay(entries)) {
      out.push({
        key: s.key,
        title:
          s.kind === 'today'
            ? t('history.today')
            : s.kind === 'yesterday'
              ? t('history.yesterday')
              : formatDateTime(s.date, 'date'),
        data: s.data.map((entry) => ({ type: 'entry' as const, entry })),
      });
    }
    return out;
  }, [pending, entries, t]);

  // Refetch page 0 on focus when the last fetch is older than 60 s (decision 11).
  useFocusEffect(
    useCallback(() => {
      if (lastFetch.current > 0 && Date.now() - lastFetch.current > STALE_MS) {
        void q.refetch({ refetchCachedPages: false });
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const refresh = () => {
    void q.refetch({ refetchCachedPages: false });
  };
  const loadMore = () => {
    if (q.hasNextPage && !q.isFetching) void q.fetchNextPage();
  };

  const failed = q.isError && entries.length === 0;
  if (!q.isLoading && !failed && sections.length === 0) {
    const hours = me.data?.limits.resultRetentionHours;
    return (
      <Screen edges="none">
        {segments ? (
          <Text className="px-4 pb-2 pt-3 text-xl font-semibold">{t('history.title')}</Text>
        ) : null}
        {segments}
        <EmptyState
          icon={History}
          title={t('history.empty.title')}
          body={
            hours
              ? t('history.empty.body', { retention: formatRetention(hours) })
              : t('history.empty.bodyShort')
          }
          actionLabel={t('history.empty.cta')}
          onAction={() => router.navigate(TOOLS_TAB)}
        />
      </Screen>
    );
  }

  return (
    <Screen edges="none">
      <Text className="px-4 pb-2 pt-3 text-xl font-semibold">{t('history.title')}</Text>
      {segments}
      {failed ? (
        <View className="items-center gap-3 px-8 py-10" testID="history-error">
          <Text className="text-center text-muted-fg">{t('history.loadFailed')}</Text>
          <Button label={t('history.retry')} variant="secondary" onPress={refresh} />
        </View>
      ) : (
        <SectionList<Row, { key: string; title: string; data: Row[] }>
          testID="history-list"
          sections={sections}
          keyExtractor={(r) => (r.type === 'entry' ? r.entry.jobId : r.localId)}
          renderSectionHeader={({ section }) => (
            <Text className="bg-surface-0 px-4 pb-1 pt-3 text-sm font-semibold text-muted-fg">
              {section.title}
            </Text>
          )}
          renderItem={({ item }) =>
            item.type === 'pending' ? (
              <PendingRow record={jobs.byLocalId[item.localId]!} />
            ) : (
              <HistoryRow
                entry={item.entry}
                onOpen={actions.open}
                onDelete={(entry) => actions.setSheet({ kind: 'delete', entry })}
                onKeepLonger={(entry) => actions.setSheet({ kind: 'keep', entry })}
                onMenu={(entry) => actions.setSheet({ kind: 'menu', entry })}
              />
            )
          }
          stickySectionHeadersEnabled
          onEndReached={loadMore}
          onEndReachedThreshold={0.6}
          refreshControl={
            <RefreshControl
              refreshing={q.isFetching && !q.isFetchingNextPage && !q.isLoading}
              onRefresh={refresh}
              tintColor={colors.primary}
            />
          }
          ListFooterComponent={
            q.isFetchingNextPage || q.isLoading ? (
              <ActivityIndicator className="py-4" color={colors.primary} testID="history-spinner" />
            ) : q.isError && entries.length > 0 ? (
              <View className="items-center gap-2 py-4" testID="history-error-more">
                <Text className="text-muted-fg">{t('history.loadFailed')}</Text>
                <Button label={t('history.retry')} variant="ghost" onPress={loadMore} />
              </View>
            ) : null
          }
        />
      )}
      <HistorySheets
        sheet={actions.sheet}
        onClose={() => actions.setSheet(null)}
        onSheet={actions.setSheet}
        onDelete={(e) => void actions.confirmDelete(e)}
        onKeep={(e, h) => void actions.keepLonger(e, h)}
      />
    </Screen>
  );
}

// i18n-keys: history.title, history.today, history.yesterday, history.inProgress, history.segments.jobs, history.segments.projects
