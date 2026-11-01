import { Directory, File } from 'expo-file-system';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { trackResultArchiveEntry, trackResultPreviewed } from '@/analytics/resultEvents';
import { formatBytes } from '@/lib/format';
import { Button } from '@/ui/components/Button';
import { Num, Text } from '@/ui/components/Text';
import { ArchiveError, isOverArchiveCap, openArchive, type ArchiveEntry } from '../archive';
import { resultDir } from '../cache';
import { sanitizeName } from '@/files/mime';
import { ZoomContainer, useZoomState } from '../ZoomContainer';
import { useResultFile } from '../useResultFile';
import { LoadState } from './LoadState';
import type { ViewerProps } from './types';

type Opened =
  | { status: 'loading' }
  | { status: 'ready'; entries: ArchiveEntry[]; truncated: boolean }
  | { status: 'error' };

/** Writes ONE extracted entry under `results/<jobId>/entries/` (never the whole archive). */
export function writeEntry(jobId: string, entry: ArchiveEntry): File {
  const dir = new Directory(resultDir(jobId), 'entries');
  dir.create({ intermediates: true, idempotent: true });
  const dest = new File(dir, sanitizeName(entry.path.split('/').pop() ?? 'entry', 'entry'));
  dest.create({ overwrite: true });
  dest.write(entry.data!());
  return dest;
}

function EntryPreview({ uri, onClose }: { uri: string; onClose: () => void }) {
  const { t } = useTranslation();
  const zoom = useZoomState();
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} transparent={false}>
      <View className="flex-1 gap-3 bg-surface-0 p-4 pt-12">
        <ZoomContainer zoom={zoom} style={{ flex: 1 }}>
          <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="contain" />
        </ZoomContainer>
        <Button label={t('common.close')} variant="secondary" onPress={onClose} />
      </View>
    </Modal>
  );
}

export function ArchiveViewer({ descriptor, context }: ViewerProps) {
  const { t } = useTranslation();
  const tooLarge = isOverArchiveCap(descriptor.sizeBytes);
  const { state, reload } = useResultFile(
    descriptor.jobId,
    descriptor.fileName,
    descriptor.sizeBytes,
    !tooLarge,
  );
  const [opened, setOpened] = useState<Opened>({ status: 'loading' });
  const [preview, setPreview] = useState<string | null>(null);
  const [entryError, setEntryError] = useState(false);

  useEffect(() => {
    if (state.status !== 'ready') return;
    let live = true;
    openArchive(state.file, descriptor.fileName)
      .then((a) => {
        if (!live) return;
        setOpened({ status: 'ready', entries: a.entries, truncated: a.truncated });
        trackResultPreviewed(context, 'archive');
      })
      .catch((e) => {
        if (live) setOpened({ status: 'error' });
        void (e instanceof ArchiveError);
      });
    return () => {
      live = false;
    };
  }, [state, descriptor.fileName, context]);

  if (tooLarge) return <Text className="py-4 text-muted-fg">{t('result.archiveTooLarge')}</Text>;
  if (state.status !== 'ready') return <LoadState state={state} onRetry={reload} />;
  if (opened.status === 'loading') {
    return <LoadState state={{ status: 'loading', progress: 0 }} onRetry={reload} />;
  }
  if (opened.status === 'error') {
    return <Text className="py-4 text-danger">{t('result.archiveUnreadable')}</Text>;
  }
  const files = opened.entries.filter((e) => !e.isDir);
  if (files.length === 0)
    return <Text className="py-4 text-muted-fg">{t('result.archiveEmpty')}</Text>;

  const open = (entry: ArchiveEntry) => {
    if (entry.kind !== 'image' && entry.kind !== 'gif') return;
    try {
      const file = writeEntry(descriptor.jobId, entry);
      trackResultArchiveEntry(context, entry.kind);
      setEntryError(false);
      setPreview(file.uri);
    } catch {
      setEntryError(true);
    }
  };

  return (
    <View className="gap-2" testID="archive-list">
      <Num className="text-sm text-muted-fg">
        {t('interface:resultPanel.archive.summary', { count: files.length })}
      </Num>
      {opened.truncated ? (
        <Text className="text-sm text-danger">{t('interface:resultPanel.archive.truncated')}</Text>
      ) : null}
      {entryError ? <Text className="text-sm text-danger">{t('result.entryFailed')}</Text> : null}
      <ScrollView style={{ maxHeight: 360 }} nestedScrollEnabled>
        {files.map((e) => {
          const openable = e.kind === 'image' || e.kind === 'gif';
          return (
            <Pressable
              key={e.path}
              disabled={!openable}
              onPress={() => open(e)}
              accessibilityRole={openable ? 'button' : 'text'}
              className="flex-row items-center justify-between gap-3 border-b border-edge py-3"
            >
              <Text className={`flex-1 ${openable ? '' : 'text-muted-fg'}`} numberOfLines={1}>
                {e.path}
              </Text>
              <Num className="text-xs text-subtle">{formatBytes(e.size)}</Num>
            </Pressable>
          );
        })}
      </ScrollView>
      {preview ? <EntryPreview uri={preview} onClose={() => setPreview(null)} /> : null}
    </View>
  );
}
