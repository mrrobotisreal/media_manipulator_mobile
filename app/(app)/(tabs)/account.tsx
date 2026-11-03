import { useRouter } from 'expo-router';
import { ChevronLeft, ChevronRight, CircleUser, Languages } from 'lucide-react-native';
import { useState } from 'react';
import { I18nManager, Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { performSignOut } from '@/auth/signOut';
import { useAppDispatch, useAppSelector } from '@/state/hooks';
import { analyticsOptOutSet } from '@/state/slices/settings';
import { Button, EmptyState, Screen, Sheet, Text } from '@/ui/components';
import { ToggleRow } from '@/ui/components/ToggleRow';
import { colors } from '@/ui/tokens';

export default function AccountTab() {
  const { t } = useTranslation();
  const router = useRouter();
  const dispatch = useAppDispatch();
  const [confirming, setConfirming] = useState(false);
  const optedOut = useAppSelector((s) => s.settings.analyticsOptOut);
  return (
    <Screen edges="none">
      <EmptyState
        icon={CircleUser}
        title={t('tabs.account')}
        body={t('placeholders.accountBody')}
      />
      <View className="gap-3 px-4 pb-6">
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
        {/* MA07: interim placement; MA22 moves it into Account -> Privacy. */}
        <View className="rounded-lg border border-edge bg-surface-1 px-4 py-2">
          <ToggleRow
            label={t('analytics.optOut.title')}
            hint={t('analytics.optOut.helper')}
            value={!optedOut}
            onChange={(share) => dispatch(analyticsOptOutSet(!share))}
          />
        </View>
        <Button
          label={t('common.signOut')}
          variant="secondary"
          onPress={() => setConfirming(true)}
        />
      </View>
      <Sheet visible={confirming} onClose={() => setConfirming(false)}>
        <View className="gap-3">
          <Text className="text-lg font-semibold">{t('auth.signOut.confirmTitle')}</Text>
          <Text className="text-muted-fg">{t('auth.signOut.confirmBody')}</Text>
          <Button
            label={t('common.signOut')}
            variant="danger"
            onPress={() => {
              setConfirming(false);
              void performSignOut(dispatch);
            }}
          />
          <Button label={t('common.cancel')} variant="ghost" onPress={() => setConfirming(false)} />
        </View>
      </Sheet>
    </Screen>
  );
}
