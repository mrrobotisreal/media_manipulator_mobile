/**
 * A Darkroom project's render history (ticket MA58 decision 2): `GET /studio/projects/:id/exports`
 * (newest first). A completed row whose file is still on the server opens its result (MA13; save
 * and share via MA14); every finished row offers Export again
 * (`POST /studio/projects/:id/exports/:exportId/again`, a new render of the project's CURRENT saved
 * state with the stored options), started through the `studioExport` job starter.
 */
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import type { StudioExportRow, StudioProjectSummary } from '@/api/schemas/studio';
import { formatDateTime } from '@/lib/format';
import { useGetStudioExportOptionsQuery, useListStudioExportsQuery } from '@/studio/mobile/api';
import { Button } from '@/ui/components/Button';
import { Sheet } from '@/ui/components/Sheet';
import { Num, Text } from '@/ui/components/Text';
import { colors, hitTarget } from '@/ui/tokens';
import { againProps, containerFile, isAudioOnlyContainer, outputHumanLabel } from './exportModel';
import { startStudioExportJob } from './startStudioExport';

/** The web's `errorClassKey`: a known coarse class, else `generic`. */
export function exportErrorKey(error: string | undefined): string {
  switch (error) {
    case 'timeout':
    case 'unsupported':
    case 'gpu':
    case 'oom':
    case 'disk':
    case 'interrupted':
    case 'cancelled':
    case 'upstream':
    case 'corrupt_input':
    case 'too_large':
      return error;
    default:
      return 'generic';
  }
}

function statusKey(s: string): string {
  return s === 'completed' || s === 'failed' || s === 'running' ? s : 'running';
}

// i18n-keys: interface:contentStudio.exports.status_running, interface:contentStudio.exports.status_completed, interface:contentStudio.exports.status_failed, interface:contentStudio.exports.error_generic, interface:contentStudio.exports.error_timeout, interface:contentStudio.exports.error_unsupported, interface:contentStudio.exports.error_gpu, interface:contentStudio.exports.error_oom, interface:contentStudio.exports.error_disk, interface:contentStudio.exports.error_interrupted, interface:contentStudio.exports.error_cancelled, interface:contentStudio.exports.error_upstream, interface:contentStudio.exports.error_corrupt_input, interface:contentStudio.exports.error_too_large
function ExportRowView({
  row,
  onOpen,
  onAgain,
}: {
  row: StudioExportRow;
  onOpen(r: StudioExportRow): void;
  onAgain(r: StudioExportRow): void;
}) {
  const { t } = useTranslation();
  const label = row.container
    ? outputHumanLabel(row)
    : row.format.toUpperCase();
  const res =
    row.resolution > 0 ? `${row.resolution}p` : t('interface:contentStudio.exports.canvas');
  const openable = row.status === 'completed' && row.available;
  return (
    <View className="gap-2 border-b border-edge py-3" testID={`studio-export-row-${row.id}`}>
      <Pressable
        accessibilityRole="button"
        disabled={!openable}
        onPress={() => onOpen(row)}
        style={{ minHeight: hitTarget }}
        className="gap-0.5"
      >
        <Text className="font-semibold">{label}</Text>
        <View className="flex-row flex-wrap items-center gap-x-2">
          <Num className="text-xs text-muted-fg">{res}</Num>
          <Num className="text-xs text-muted-fg">{formatDateTime(row.createdAt)}</Num>
          <Text className="text-xs text-muted-fg">
            {t(`interface:contentStudio.exports.status_${statusKey(row.status)}`)}
          </Text>
        </View>
        {row.status === 'failed' ? (
          <Text className="text-xs text-danger">
            {t(`interface:contentStudio.exports.error_${exportErrorKey(row.error)}`)}
          </Text>
        ) : null}
        {row.status === 'completed' && !row.available ? (
          <Text className="text-xs text-subtle">{t('interface:contentStudio.exports.expired')}</Text>
        ) : null}
      </Pressable>
      <View className="flex-row flex-wrap gap-2">
        {openable ? (
          <Button
            testID={`studio-export-open-${row.id}`}
            variant="secondary"
            label={t('darkroom.export.openResult')}
            onPress={() => onOpen(row)}
          />
        ) : null}
        {row.status !== 'running' ? (
          <Button
            testID={`studio-export-again-${row.id}`}
            variant="ghost"
            label={t('interface:contentStudio.export.again')}
            onPress={() => onAgain(row)}
          />
        ) : null}
      </View>
    </View>
  );
}

export function StudioExportsSheet({
  project,
  onClose,
}: {
  project: StudioProjectSummary | null;
  onClose(): void;
}) {
  const { t } = useTranslation();
  const [shown, setShown] = useState<StudioProjectSummary | null>(project);
  // Keep the last project while the sheet animates out (render-time update, not an effect).
  if (project && project !== shown) setShown(project);
  const visible = project !== null;
  const q = useListStudioExportsQuery(shown?.id ?? '', { skip: !visible || !shown });
  const options = useGetStudioExportOptionsQuery(undefined, { skip: !visible });

  const open = (r: StudioExportRow) => {
    onClose();
    router.push(`/(app)/job/${encodeURIComponent(r.jobId)}?from=history` as Href);
  };

  const again = (r: StudioExportRow) => {
    if (!shown) return;
    const table = options.data?.table;
    const container = r.container || 'mp4';
    const file = table ? containerFile(container, table) : { ext: container, mime: 'video/mp4' };
    const localId = startStudioExportJob({
      options: {
        projectId: shown.id,
        againExportId: r.id,
        timelineSeconds: shown.durationSeconds,
        props: againProps(r, table),
      },
      fileName: shown.name.trim() || 'export',
      ext: file.ext,
      mime: file.mime,
      audioOnly: table ? isAudioOnlyContainer(container, table) : false,
    });
    onClose();
    if (localId) router.push(`/(app)/job/${localId}` as Href);
  };

  const rows = q.data ?? [];
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View className="gap-2" testID="studio-exports-sheet">
        <Text className="text-lg font-semibold">{t('interface:contentStudio.exports.title')}</Text>
        {q.isLoading ? (
          <ActivityIndicator color={colors.primary} />
        ) : q.isError ? (
          <View className="gap-3" testID="studio-exports-error">
            <Text className="text-muted-fg">
              {t('interface:contentStudio.exports.loadFailed')}
            </Text>
            <Button label={t('history.retry')} variant="secondary" onPress={() => void q.refetch()} />
          </View>
        ) : rows.length === 0 ? (
          <Text className="text-muted-fg" testID="studio-exports-empty">
            {t('interface:contentStudio.exports.empty')}
          </Text>
        ) : (
          <ScrollView style={{ maxHeight: 480 }}>
            {rows.map((r) => (
              <ExportRowView key={r.id} row={r} onOpen={open} onAgain={again} />
            ))}
          </ScrollView>
        )}
        <Button variant="ghost" label={t('common.close')} onPress={onClose} />
      </View>
    </Sheet>
  );
}
