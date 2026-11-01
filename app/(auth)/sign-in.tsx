import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/state/hooks';
import { devShellEntered } from '@/state/slices/auth';
import { Button, Screen, Text, Wordmark } from '@/ui/components';

export default function SignIn() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const status = useAppSelector((s) => s.auth.status);
  if (status === 'ready') return <Redirect href="/(app)/(tabs)" />;
  return (
    <Screen className="items-center justify-center gap-6 px-6">
      <Wordmark />
      <Text className="text-muted-fg">{t('placeholders.signInBody')}</Text>
      {__DEV__ ? (
        <View className="self-stretch">
          {/* Dev shell: deleted by MA04. */}
          <Button label={t('placeholders.openShell')} onPress={() => dispatch(devShellEntered())} />
        </View>
      ) : null}
    </Screen>
  );
}
