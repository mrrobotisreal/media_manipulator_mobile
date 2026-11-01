import { File as FileIcon } from 'lucide-react-native';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatBytes } from '@/lib/format';
import { Num, Text } from '@/ui/components/Text';
import { colors } from '@/ui/tokens';
import type { ViewerProps } from './types';

/** Kinds with no v1 viewer (transcript, captions, metadata, summary, hls, dash, unknown): info only. */
export function UnknownViewer({ descriptor }: ViewerProps) {
  const { t } = useTranslation();
  return (
    <View className="items-start gap-2" testID="unknown-viewer">
      <FileIcon size={32} color={colors.mutedFg} />
      <Text className="font-semibold">{descriptor.fileName}</Text>
      <Text className="text-sm text-muted-fg">
        {t('interface:resultPanel.unknown.type')}: {descriptor.mime}
      </Text>
      {descriptor.sizeBytes !== undefined ? (
        <Num className="text-sm text-muted-fg">
          {t('interface:resultPanel.unknown.size')}: {formatBytes(descriptor.sizeBytes)}
        </Num>
      ) : null}
      <Text className="text-muted-fg">{t('result.unknownBody')}</Text>
    </View>
  );
}
