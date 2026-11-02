import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import {
  diffUnavailableReason,
  useGetJobMetadataDiffQuery,
  useGetJobMetadataQuery,
} from '@/api/endpoints/metadata';
import { MultiChips } from '@/ui/components/Chips';
import { Button } from '@/ui/components/Button';
import { ProcessingIndicator } from '@/ui/components/ProcessingIndicator';
import { Sheet } from '@/ui/components/Sheet';
import { Num, Text } from '@/ui/components/Text';
import { categoryRank } from '../categories';
import { buildDiffModel, type DiffKind, type DiffRow } from '../diff-model';
import { humanizeTag } from '../humanize';
import type { DiffResult } from '../diffResult';
import type { MetadataDocument } from '../types';

type Filter = 'removed' | 'added' | 'changed' | 'unchanged';
const FILTERS: Filter[] = ['removed', 'added', 'changed', 'unchanged'];

function RowView({ row }: { row: DiffRow }) {
  const { t } = useTranslation();
  const expected = row.kind === 'expected';
  return (
    <View className="gap-0.5 border-b border-edge py-2" testID={`diff-row-${row.id}`}>
      <View className="flex-row flex-wrap items-center gap-2">
        <Text className="text-sm text-muted-fg">{humanizeTag(row.tag)}</Text>
        <Text className={`text-xs ${row.kind === 'removed' ? 'text-danger' : 'text-primary'}`}>
          {t(`result.metadata.diff.kind.${expected ? 'changed' : row.kind}`)}
        </Text>
        {expected ? (
          <Text className="text-xs text-subtle">{t('result.metadata.diff.expected')}</Text>
        ) : null}
      </View>
      {row.before !== '' ? (
        <Num numberOfLines={3} style={{ writingDirection: 'ltr', textAlign: 'auto' }}>
          {row.after !== '' && row.kind !== 'unchanged' ? `− ${row.before}` : row.before}
        </Num>
      ) : null}
      {row.after !== '' && row.kind !== 'unchanged' && row.kind !== 'removed' ? (
        <Num numberOfLines={3} style={{ writingDirection: 'ltr', textAlign: 'auto' }}>
          {row.before !== '' ? `+ ${row.after}` : row.after}
        </Num>
      ) : null}
    </View>
  );
}

/** Pure body so tests can render it without the network. */
export function DiffBody({
  diff,
  original,
}: {
  diff: DiffResult;
  original: MetadataDocument | undefined;
}) {
  const { t } = useTranslation();
  const model = useMemo(() => buildDiffModel(diff, original), [diff, original]);
  const [filters, setFilters] = useState<Filter[]>(['removed', 'added', 'changed']);
  const matches = (kind: DiffKind) => filters.includes(kind === 'expected' ? 'changed' : kind);
  const categories = model.categories
    .map((c) => ({ ...c, rows: c.rows.filter((r) => matches(r.kind)) }))
    .filter((c) => c.rows.length > 0)
    .sort((a, b) => categoryRank(a.id) - categoryRank(b.id));
  return (
    <View className="gap-3" testID="diff-body">
      <View className="flex-row flex-wrap gap-x-4 gap-y-1" testID="diff-counts">
        {FILTERS.map((f) => (
          <Num key={f} className="text-sm text-muted-fg">
            {t(`result.metadata.diff.counts.${f}`, { count: model.totals[f] })}
          </Num>
        ))}
      </View>
      <MultiChips<Filter>
        options={FILTERS.map((f) => ({ value: f, label: t(`result.metadata.diff.kind.${f}`) }))}
        value={filters}
        onToggle={(f) =>
          setFilters((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]))
        }
      />
      {categories.length === 0 ? (
        <Text className="text-muted-fg">{t('result.metadata.diff.empty')}</Text>
      ) : (
        categories.map((c) => (
          <View key={c.id} testID={`diff-category-${c.id}`}>
            <Text className="font-semibold">
              {t(`tools.metadata.categories.${c.id}`, { defaultValue: c.id })}
            </Text>
            {c.rows.map((r) => (
              <RowView key={`${r.kind}-${r.id}`} row={r} />
            ))}
          </View>
        ))
      )}
    </View>
  );
}

/** "Metadata changes": counts, filter chips, unified list grouped by category (unified only in v1). */
export function MetadataDiffSheet({
  jobId,
  visible,
  onClose,
}: {
  jobId: string;
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const diffQ = useGetJobMetadataDiffQuery(jobId, { skip: !visible });
  const origQ = useGetJobMetadataQuery({ jobId, side: 'original' }, { skip: !visible });
  const reason = diffQ.error ? diffUnavailableReason(diffQ.error) : undefined;
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View className="max-h-[80%] gap-3" testID="diff-sheet">
        <Text className="text-base font-semibold">{t('result.metadata.diff.title')}</Text>
        <ScrollView>
          {diffQ.isLoading || origQ.isLoading ? (
            <View className="flex-row items-center gap-3">
              <ProcessingIndicator />
              <Text className="text-muted-fg">{t('result.metadata.diff.loading')}</Text>
            </View>
          ) : diffQ.error ? (
            <Text className="text-muted-fg" testID="diff-unavailable">
              {t('result.metadata.diff.unavailable', {
                reason: t(`result.metadata.diff.reason.${reason ?? 'failed'}`),
              })}
            </Text>
          ) : diffQ.data ? (
            <DiffBody diff={diffQ.data} original={origQ.data} />
          ) : null}
        </ScrollView>
        <Button label={t('common.close')} variant="secondary" onPress={onClose} />
      </View>
    </Sheet>
  );
}

// i18n-keys: result.metadata.diff.kind.removed, result.metadata.diff.kind.added, result.metadata.diff.kind.changed, result.metadata.diff.kind.unchanged, result.metadata.diff.counts.removed, result.metadata.diff.counts.added, result.metadata.diff.counts.changed, result.metadata.diff.counts.unchanged, result.metadata.diff.reason.jobNotCompleted, result.metadata.diff.reason.resultMissing, result.metadata.diff.reason.notComparable, result.metadata.diff.reason.failed
