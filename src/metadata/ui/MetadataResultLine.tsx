import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useGetJobMetadataDiffQuery } from '@/api/endpoints/metadata';
import { Button } from '@/ui/components/Button';
import { Num, Text } from '@/ui/components/Text';
import { trackDiffOpened } from '../analytics';
import { keptCount, removedLocation } from '../diff-model';
import { MetadataDiffSheet } from './MetadataDiffSheet';

/**
 * "Metadata: N kept · M removed · Compare" under a strip/edit result (MA21 decision 7). Renders nothing
 * until the diff loads and on any failure, so it never blocks the viewer. Shown only when the job
 * has both documents (`metadataAvailable.original && .result`).
 */
export function MetadataResultLine({
  jobId,
  available,
  strippedCount,
  toolSlug,
}: {
  jobId: string;
  available?: { original?: boolean; result?: boolean };
  strippedCount?: number;
  toolSlug?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const both = Boolean(available?.original && available?.result);
  const q = useGetJobMetadataDiffQuery(jobId, { skip: !both });
  const diff = q.data;
  if (!both || !diff) return null;
  const removed = strippedCount ?? diff.removed.length;
  const kept = keptCount(diff);
  return (
    <View
      className="gap-2 rounded-lg border border-edge bg-surface-1 p-3"
      testID="metadata-result-line"
    >
      {removed === 0 ? (
        <Text>{t('result.metadata.resultLine.unchanged')}</Text>
      ) : (
        <Num>{t('result.metadata.resultLine.summary', { kept, removed })}</Num>
      )}
      {removed > 0 && removedLocation(diff) ? (
        <Text className="text-sm text-muted-fg">
          {t('result.metadata.resultLine.includingLocation')}
        </Text>
      ) : null}
      <Button
        label={t('result.metadata.resultLine.compare')}
        variant="secondary"
        onPress={() => {
          trackDiffOpened(toolSlug ?? 'home', {
            removed: diff.removed.length,
            added: diff.added.length,
            changed: diff.changed.length,
          });
          setOpen(true);
        }}
        testID="metadata-compare"
      />
      <MetadataDiffSheet jobId={jobId} visible={open} onClose={() => setOpen(false)} />
    </View>
  );
}
