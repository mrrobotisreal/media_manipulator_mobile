import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/components/Button';
import { ProcessingIndicator } from '@/ui/components/ProcessingIndicator';
import { Num, Text } from '@/ui/components/Text';
import type { ResultFileState } from '../useResultFile';

/** Shared loading / gone / error body for every viewer that downloads first. */
export function LoadState({
  state,
  onRetry,
}: {
  state: Exclude<ResultFileState, { status: 'ready' }>;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  if (state.status === 'loading') {
    return (
      <View className="items-center gap-2 py-8" testID="result-loading">
        <ProcessingIndicator label={t('interface:resultPanel.loading')} />
        <Text className="text-muted-fg">{t('interface:resultPanel.loading')}</Text>
        {state.progress > 0 ? (
          <Num className="text-sm text-subtle">
            {t('result.downloading', { percent: `${Math.round(state.progress * 100)}%` })}
          </Num>
        ) : null}
      </View>
    );
  }
  if (state.status === 'gone') {
    return <Text className="py-6 text-danger">{t('result.gone')}</Text>;
  }
  return (
    <View className="items-start gap-3 py-4">
      <Text className="text-danger">{t('interface:resultPanel.loadFailed')}</Text>
      <Button label={t('interface:resultPanel.retry')} variant="secondary" onPress={onRetry} />
    </View>
  );
}
