import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { getSyncGate } from '@/auth/gate';
import { performSignOut } from '@/auth/signOut';
import { authT } from '@/auth/strings';
import { useAppDispatch, useAppSelector } from '@/state/hooks';
import { Button, Screen, Text } from '@/ui/components';

export default function SyncFailed() {
  const dispatch = useAppDispatch();
  const status = useAppSelector((s) => s.auth.status);
  if (status === 'ready') return <Redirect href="/(app)/(tabs)" />;
  if (status === 'signedOut') return <Redirect href="/(auth)/sign-in" />;
  return (
    <Screen className="items-center justify-center gap-4 px-6">
      <Text className="text-center text-xl font-semibold">{authT('sync.failedTitle')}</Text>
      <Text className="text-center text-muted-fg">{authT('sync.failedBody')}</Text>
      <View className="gap-3 self-stretch">
        <Button label={authT('sync.retry')} size="lg" onPress={() => getSyncGate()?.retry()} />
        <Button
          label={authT('sync.signOut')}
          variant="secondary"
          size="lg"
          onPress={() => void performSignOut(dispatch)}
        />
      </View>
    </Screen>
  );
}
