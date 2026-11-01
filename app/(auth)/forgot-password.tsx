import { Link } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { requestPasswordReset } from '@/auth/reset';
import { authT } from '@/auth/strings';
import { Button, Screen, Text, TextField } from '@/ui/components';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setBusy(true);
    setError(null);
    void requestPasswordReset(email).then((outcome) => {
      setBusy(false);
      if (outcome.status === 'sent') setSent(true);
      else setError(authT(`errors.${outcome.errorKey}`));
    });
  };

  return (
    <Screen>
      <ScrollView
        contentContainerClassName="grow justify-center gap-4 px-6 py-8"
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-xl font-semibold">{authT('reset.title')}</Text>
        {sent ? (
          <Text testID="reset-sent">{authT('reset.sent')}</Text>
        ) : (
          <>
            <Text className="text-muted-fg">{authT('reset.body')}</Text>
            <TextField
              label={authT('reset.email')}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              error={error}
            />
            <Button label={authT('reset.submit')} size="lg" loading={busy} onPress={submit} />
          </>
        )}
        <View className="items-center">
          <Link href="/(auth)/sign-in" asChild>
            <Text className="text-primary">{authT('reset.back')}</Text>
          </Link>
        </View>
      </ScrollView>
    </Screen>
  );
}
