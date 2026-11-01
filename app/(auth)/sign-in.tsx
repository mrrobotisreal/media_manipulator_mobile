import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { useAppDispatch, useAppSelector } from '@/state/hooks';
import { devShellEntered } from '@/state/slices/auth';
import { Button, Screen, Text, Wordmark } from '@/ui/components';

export default function SignIn() {
  const dispatch = useAppDispatch();
  const status = useAppSelector((s) => s.auth.status);
  if (status === 'ready') return <Redirect href="/(app)/(tabs)" />;
  return (
    <Screen className="items-center justify-center gap-6 px-6">
      <Wordmark />
      <Text className="text-muted-fg">Sign-in arrives in MA04</Text>
      {/* i18n: MA05 */}
      {__DEV__ ? (
        <View className="self-stretch">
          {/* Dev shell: deleted by MA04. */}
          <Button label="Open app shell" onPress={() => dispatch(devShellEntered())} />
          {/* i18n: MA05 */}
        </View>
      ) : null}
    </Screen>
  );
}
