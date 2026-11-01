import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';
import { trackFileRejected, trackFileSelected } from '@/analytics/fileEvents';
import type { AnyToolDefinition } from '@/tools/types';
import { Button } from '@/ui/components/Button';
import { Text } from '@/ui/components/Text';
import { colors } from '@/ui/tokens';
import { IntakeCopyError, prepareIntake } from '../intake';
import { KIND_MIME, PRESIGN_VIDEO_EXTENSIONS } from '../mime';
import { preflightCount } from '../preflight';
import {
  MAX_FILES_PER_SELECTION,
  type IncomingFile,
  type IntakeFile,
  type IntakeSource,
  type Rejection,
} from '../types';
import { useAccountLimits } from '../useAccountLimits';
import { FileCard, RejectionCard } from './FileCard';

const FORMATS = PRESIGN_VIDEO_EXTENSIONS.map((e) => e.toUpperCase()).join(', ');

function fromImagePicker(assets: ImagePicker.ImagePickerAsset[]): IncomingFile[] {
  return assets.map((a) => ({
    uri: a.uri,
    name: a.fileName,
    mimeType: a.mimeType,
    sizeBytes: a.fileSize,
    durationSec: a.duration ? a.duration / 1000 : null,
    width: a.width,
    height: a.height,
  }));
}

function fromDocumentPicker(assets: DocumentPicker.DocumentPickerAsset[]): IncomingFile[] {
  return assets.map((a) => ({
    uri: a.uri,
    name: a.name,
    mimeType: a.mimeType,
    sizeBytes: a.size,
  }));
}

// i18n-keys: files.pick.media, files.pick.files, files.copying, files.error.lowSpace, files.error.copyFailed
export function FileArea({
  tool,
  initialFiles = [],
  onFilesChange,
}: {
  tool: AnyToolDefinition;
  /** Files attached from the intake screen. */
  initialFiles?: IntakeFile[];
  onFilesChange?: (files: IntakeFile[]) => void;
}) {
  const { t } = useTranslation();
  const limits = useAccountLimits();
  const [files, setFiles] = useState<IntakeFile[]>(initialFiles);
  const [rejected, setRejected] = useState<Rejection[]>([]);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const batch = tool.batch === true;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const apply = useCallback(
    (next: IntakeFile[]) => {
      setFiles(next);
      onFilesChange?.(next);
    },
    [onFilesChange],
  );

  const ingest = useCallback(
    async (incoming: IncomingFile[], source: IntakeSource) => {
      setErrorKey(null);
      const count = preflightCount(incoming.length);
      if (!count.ok) {
        const r: Rejection = {
          id: 'selection',
          name: '',
          extension: '',
          mediaKind: null,
          sizeBytes: null,
          reason: 'too_many',
          limit: MAX_FILES_PER_SELECTION,
        };
        setRejected([r]);
        trackFileRejected(r);
        return;
      }
      setBusy(true);
      try {
        const res = await prepareIntake(incoming, { source, accepts: tool.accepts, limits });
        if (!mounted.current) return;
        setRejected(res.rejected);
        res.rejected.forEach(trackFileRejected);
        if (res.accepted.length > 0) {
          res.accepted.forEach(trackFileSelected);
          apply(res.accepted);
        }
      } catch (e) {
        if (mounted.current) {
          setErrorKey(
            e instanceof IntakeCopyError && e.code === 'low_space'
              ? 'files.error.lowSpace'
              : 'files.error.copyFailed',
          );
        }
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [apply, limits, tool.accepts],
  );

  const pickMedia = useCallback(async () => {
    const mediaTypes: ImagePicker.MediaType[] = [];
    if (tool.accepts.kinds.includes('image')) mediaTypes.push('images');
    if (tool.accepts.kinds.includes('video')) mediaTypes.push('videos');
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes,
      allowsMultipleSelection: batch,
      selectionLimit: batch ? MAX_FILES_PER_SELECTION : 1,
      quality: 1,
      allowsEditing: false,
    });
    if (!res.canceled) await ingest(fromImagePicker(res.assets), 'picker');
  }, [batch, ingest, tool.accepts.kinds]);

  const pickFiles = useCallback(async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: tool.accepts.kinds.map((k) => KIND_MIME[k]),
      copyToCacheDirectory: true,
      multiple: batch,
    });
    if (!res.canceled) await ingest(fromDocumentPicker(res.assets), 'documents');
  }, [batch, ingest, tool.accepts.kinds]);

  const hasMedia = tool.accepts.kinds.some((k) => k === 'image' || k === 'video');
  const toolTitle = t(tool.titleKey);

  return (
    <View className="gap-3">
      {files.map((f) => (
        <FileCard
          key={f.id}
          file={f}
          onChange={hasMedia ? pickMedia : pickFiles}
          onRemove={() => apply(files.filter((x) => x.id !== f.id))}
        />
      ))}
      {rejected.map((r) => (
        <RejectionCard key={r.id} rejection={r} toolTitle={toolTitle} formats={FORMATS} />
      ))}
      {errorKey ? (
        <Text accessibilityRole="alert" className="text-sm text-danger">
          {t(errorKey)}
        </Text>
      ) : null}
      {busy ? (
        <View className="flex-row items-center justify-center gap-2 py-2">
          <ActivityIndicator color={colors.data} />
          <Text className="text-muted-fg">{t('files.copying')}</Text>
        </View>
      ) : null}
      {files.length === 0 ? (
        <View className="gap-2 rounded-lg border border-dashed border-edge-control p-4">
          <Text className="text-center text-muted-fg">{t('tool.fileArea')}</Text>
          <View className="flex-row flex-wrap justify-center gap-2">
            {hasMedia ? (
              <Button label={t('files.pick.media')} onPress={pickMedia} disabled={busy} />
            ) : null}
            <Button
              label={t('files.pick.files')}
              variant={hasMedia ? 'secondary' : 'primary'}
              onPress={pickFiles}
              disabled={busy}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}
