import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { formatPercent } from '@/lib/format';
import type { JobRecord } from '@/jobs/types';
import { getTool } from '@/tools/registry';
import { ToolIcon } from '@/tools/icons';
import { colors, hitTarget } from '@/ui/tokens';
import { Num, Text } from '@/ui/components/Text';

/** A local job the server has not listed yet (decision 5), rendered from the `jobs` slice record. */
export function PendingRow({ record }: { record: JobRecord }) {
  const { t } = useTranslation();
  const tool = getTool(record.toolId);
  const uploading =
    record.state === 'queued' || record.state === 'uploading' || record.state === 'finalizing';
  return (
    <Pressable
      testID={`pending-row-${record.localId}`}
      accessibilityRole="button"
      onPress={() =>
        router.push(`/(app)/job/${encodeURIComponent(record.jobId ?? record.localId)}` as Href)
      }
      className="flex-row items-center gap-3 bg-surface-0 px-4 py-3"
      style={{ minHeight: hitTarget }}
    >
      <ToolIcon name={tool?.icon ?? 'Wrench'} size={22} color={colors.data} />
      <View className="flex-1 gap-0.5">
        <Text className="text-base font-semibold" numberOfLines={1}>
          {tool ? t(tool.titleKey) : record.fileName}
        </Text>
        <View className="flex-row items-center gap-2">
          <Num className="text-xs text-muted-fg">{record.sourceExtension.toUpperCase()}</Num>
          <Text className="text-xs text-muted-fg">{t(`job.state.${record.state}`)}</Text>
          {uploading ? (
            <Num className="text-xs text-data" testID="pending-percent">
              {formatPercent(record.uploadProgress)}
            </Num>
          ) : record.progress > 0 ? (
            <Num className="text-xs text-data">{formatPercent(record.progress / 100)}</Num>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

// i18n-keys: job.state.queued, job.state.uploading, job.state.finalizing, job.state.pending, job.state.processing, job.state.upload_failed
