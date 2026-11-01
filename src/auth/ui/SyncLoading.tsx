import { ActivityIndicator, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors } from '@/ui/tokens';

/** Splash-coloured hold while the auth state is resolving or `/account/sync` runs. */
export function SyncLoading() {
  const { t } = useTranslation();
  return (
    <View
      className="flex-1 items-center justify-center bg-surface-0"
      accessibilityLabel={t('common.loading')}
      testID="sync-loading"
    >
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}
