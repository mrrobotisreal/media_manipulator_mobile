import { Image } from 'expo-image';
import { AlertTriangle, FileText, Film, Image as ImageIcon, Music } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { formatBytes, formatDuration } from '@/lib/format';
import type { MediaKind } from '@/tools/types';
import { Button } from '@/ui/components/Button';
import { Num, Text } from '@/ui/components/Text';
import { colors } from '@/ui/tokens';
import type { IntakeFile, Rejection } from '../types';

const KIND_ICON = { image: ImageIcon, video: Film, audio: Music, pdf: FileText } as const;

export function KindIcon({ kind, size = 24 }: { kind: MediaKind | null; size?: number }) {
  const Icon = kind ? KIND_ICON[kind] : FileText;
  return <Icon size={size} color={colors.data} />;
}

/** Selected-file card: thumbnail (image) or kind icon, extension, size, duration, Change/Remove. */
export function FileCard({
  file,
  onChange,
  onRemove,
}: {
  file: IntakeFile;
  onChange?: () => void;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View className="gap-3 rounded-lg border border-edge bg-surface-1 p-3">
      <View className="flex-row items-center gap-3">
        <View className="h-14 w-14 items-center justify-center overflow-hidden rounded-md bg-surface-2">
          {file.mediaKind === 'image' ? (
            <Image
              source={{ uri: file.uri }}
              style={{ width: 56, height: 56 }}
              contentFit="cover"
              accessibilityIgnoresInvertColors
            />
          ) : (
            <KindIcon kind={file.mediaKind} />
          )}
        </View>
        <View className="flex-1 gap-0.5">
          <Text numberOfLines={1} className="font-semibold">
            {file.name}
          </Text>
          <View className="flex-row flex-wrap items-center gap-x-2">
            <Text className="text-xs text-subtle">{t(`files.kinds.${file.mediaKind}`)}</Text>
            {file.extension ? (
              <Num className="text-xs text-muted-fg">{file.extension.toUpperCase()}</Num>
            ) : null}
            <Num className="text-xs text-muted-fg">{formatBytes(file.sizeBytes)}</Num>
            {file.durationSec !== undefined ? (
              <Num className="text-xs text-muted-fg">{formatDuration(file.durationSec)}</Num>
            ) : null}
          </View>
        </View>
      </View>
      {onChange || onRemove ? (
        <View className="flex-row gap-2">
          {onChange ? (
            <Button label={t('files.change')} variant="secondary" onPress={onChange} />
          ) : null}
          {onRemove ? (
            <Button label={t('files.remove')} variant="ghost" onPress={onRemove} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// i18n-keys: files.kinds.image, files.kinds.video, files.kinds.audio, files.kinds.pdf
export function RejectionCard({
  rejection,
  toolTitle,
  formats,
}: {
  rejection: Rejection;
  /** Present on the tool screen; absent on the tool-agnostic intake screen. */
  toolTitle?: string;
  /** Allowed video extensions, upper-case, shown when a video fails the extension rule. */
  formats?: string;
}) {
  const { t } = useTranslation();
  let message: string;
  switch (rejection.reason) {
    case 'too_large':
      message = t('intake.rejected.tooLarge', {
        size: formatBytes(rejection.sizeBytes ?? 0),
        limit: formatBytes(rejection.limit ?? 0),
      });
      break;
    case 'too_long':
      message = t('intake.rejected.tooLong', {
        duration: formatDuration(rejection.durationSec ?? 0),
        limit: formatDuration(rejection.limit ?? 0),
      });
      break;
    case 'empty':
      message = t('intake.rejected.empty');
      break;
    case 'too_many':
      message = t('intake.rejected.tooMany', { count: rejection.limit ?? 10 });
      break;
    default:
      message =
        rejection.mediaKind === 'video' && formats
          ? t('intake.rejected.videoFormat', { formats })
          : toolTitle
            ? t('intake.rejected.unsupported', { tool: toolTitle })
            : t('intake.rejected.unsupportedAny');
  }
  return (
    <View
      accessibilityRole="alert"
      className="flex-row items-start gap-3 rounded-lg border border-danger bg-surface-1 p-3"
    >
      <AlertTriangle size={20} color={colors.danger} />
      <View className="flex-1 gap-0.5">
        {rejection.reason !== 'too_many' ? (
          <Text numberOfLines={1} className="text-sm font-semibold">
            {rejection.name}
          </Text>
        ) : null}
        <Text className="text-sm text-muted-fg">{message}</Text>
      </View>
    </View>
  );
}
