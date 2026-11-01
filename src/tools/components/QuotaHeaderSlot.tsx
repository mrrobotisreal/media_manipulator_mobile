import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

/** Same-height placeholder for the quota meters; MA16 replaces the body (no numbers in MA10). */
export function QuotaHeaderSlot() {
  const { t } = useTranslation();
  return (
    <View
      testID="quota-header-slot"
      accessibilityLabel={t('tools.quotaSlot')}
      className="mx-4 mt-3 h-14 justify-center rounded-lg border border-edge bg-surface-1 px-3"
    >
      <View className="h-2 w-1/2 rounded-sm bg-surface-3" />
    </View>
  );
}
