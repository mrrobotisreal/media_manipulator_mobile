import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';
import { colors } from '@/ui/tokens';
import { Button } from '@/ui/components/Button';
import { Text } from '@/ui/components/Text';
import { MetadataInspector } from '@/metadata/ui/MetadataInspector';
import { useInspect } from '@/metadata/useInspect';
import type { MetadataDocument } from '@/metadata/types';
import type { ToolInputInfo } from '../../types';

/** Loading / error / inspector for the picked file; `children` render under a ready document. */
export function InspectPanel({
  input,
  children,
}: {
  input?: ToolInputInfo;
  children?: (doc: MetadataDocument) => React.ReactNode;
}) {
  const { t } = useTranslation();
  const state = useInspect(input);
  if (!input) return null;
  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <View className="flex-row items-center gap-3" testID="inspect-loading">
        <ActivityIndicator color={colors.data} />
        <Text className="text-muted-fg">{t('tools.metadata.inspecting')}</Text>
      </View>
    );
  }
  if (state.status === 'error') {
    return (
      <View className="gap-2" testID="inspect-error">
        <Text accessibilityRole="alert" className="text-danger">
          {t('tools.metadata.inspectFailed')}
        </Text>
        <Button label={t('common.retry')} variant="secondary" onPress={state.retry} />
      </View>
    );
  }
  return (
    <View className="gap-4">
      {children ? children(state.document) : null}
      <MetadataInspector document={state.document} surface="tool_page" />
    </View>
  );
}
