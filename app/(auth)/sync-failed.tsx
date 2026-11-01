import { Redirect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { getSyncGate } from '@/auth/gate';
import { performSignOut } from '@/auth/signOut';
import { useAppDispatch, useAppSelector } from '@/state/hooks';
import { Button, Screen, Text } from '@/ui/components';

export default function SyncFailed() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const status = useAppSelector((s) => s.auth.status);
  if (status === 'ready') return <Redirect href="/(app)/(tabs)" />;
  if (status === 'signedOut') return <Redirect href="/(auth)/sign-in" />;
  return (
    <Screen className="items-center justify-center gap-4 px-6">
      <Text className="text-center text-xl font-semibold">{t('auth.sync.failedTitle')}</Text>
      <Text className="text-center text-muted-fg">{t('auth.sync.failedBody')}</Text>
      <View className="gap-3 self-stretch">
        <Button label={t('common.retry')} size="lg" onPress={() => getSyncGate()?.retry()} />
        <Button
          label={t('common.signOut')}
          variant="secondary"
          size="lg"
          onPress={() => void performSignOut(dispatch)}
        />
      </View>
    </Screen>
  );
}
