import { useRouter } from 'expo-router';
import { ChevronLeft, ChevronRight, CircleUser, Languages } from 'lucide-react-native';
import { I18nManager, Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { EmptyState, Screen, Text } from '@/ui/components';
import { colors } from '@/ui/tokens';

export default function AccountTab() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Screen>
      <EmptyState
        icon={CircleUser}
        title={t('tabs.account')}
        body={t('placeholders.accountBody')}
      />
      <View className="px-4 pb-6">
        <Pressable
          accessibilityRole="button"
          className="min-h-[48px] flex-row items-center gap-3 rounded-lg border border-edge bg-surface-1 px-4"
          onPress={() => router.push('/(app)/language')}
        >
          <Languages size={20} color={colors.mutedFg} />
          <Text className="flex-1">{t('language.title')}</Text>
          {I18nManager.isRTL ? (
            <ChevronLeft size={20} color={colors.mutedFg} />
          ) : (
            <ChevronRight size={20} color={colors.mutedFg} />
          )}
        </Pressable>
      </View>
    </Screen>
  );
}
