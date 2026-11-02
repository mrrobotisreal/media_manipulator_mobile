import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { authErrorI18nKey } from '@/auth/errors';
import { useState } from 'react';
import { View } from 'react-native';
import { requestPasswordReset } from '@/auth/reset';
import { Button, Screen, Text, TextField, KeyboardScroll } from '@/ui/components';

export default function ForgotPassword() {
  const { t } = useTranslation();
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
      else setError(t(authErrorI18nKey(outcome.errorKey)));
    });
  };

  return (
    <Screen>
      <KeyboardScroll
        contentContainerClassName="grow justify-center gap-4 px-6 py-8"
      >
        <Text className="text-xl font-semibold">{t('interface:authModal.reset.title')}</Text>
        {sent ? (
          <Text testID="reset-sent">{t('interface:authModal.reset.sent')}</Text>
        ) : (
          <>
            <Text className="text-muted-fg">{t('interface:authModal.reset.body')}</Text>
            <TextField
              label={t('interface:authModal.fields.email')}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              error={error}
            />
            <Button
              label={t('interface:authModal.reset.submit')}
              size="lg"
              loading={busy}
              onPress={submit}
            />
          </>
        )}
        <View className="items-center">
          <Link href="/(auth)/sign-in" asChild>
            <Text className="text-primary">{t('interface:authModal.reset.back')}</Text>
          </Link>
        </View>
      </KeyboardScroll>
    </Screen>
  );
}
