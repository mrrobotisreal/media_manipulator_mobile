import { Link, Redirect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { authErrorI18nKey } from '@/auth/errors';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { trackAuthScreenShown } from '@/auth/analytics';
import { isValidDisplayName, isValidEmail, isValidPassword } from '@/auth/email';
import { signUpWithEmailFlow } from '@/auth/signIn';
import { isFirebaseConfigured } from '@/lib/firebaseAvailable';
import { useAppDispatch, useAppSelector } from '@/state/hooks';
import { Button, Screen, Text, TextField } from '@/ui/components';

export default function SignUp() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const status = useAppSelector((s) => s.auth.status);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trackAuthScreenShown('signup');
  }, []);

  if (status === 'ready') return <Redirect href="/(app)/(tabs)" />;
  if (!isFirebaseConfigured()) return <Redirect href="/(auth)/sign-in" />;

  const submit = () => {
    if (!isValidDisplayName(name)) return setError(t('auth.errors.nameRequired'));
    if (!isValidEmail(email)) return setError(t('error:auth.invalidEmail'));
    if (!isValidPassword(password)) return setError(t('error:auth.passwordTooShort'));
    setBusy(true);
    setError(null);
    void signUpWithEmailFlow(email, password, name, dispatch).then((outcome) => {
      setBusy(false);
      if (outcome.status === 'error') setError(t(authErrorI18nKey(outcome.errorKey)));
    });
  };

  return (
    <Screen>
      <ScrollView
        contentContainerClassName="grow justify-center gap-4 px-6 py-8"
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-xl font-semibold">{t('auth.signUp.title')}</Text>
        <TextField
          label={t('auth.signUp.name')}
          value={name}
          onChangeText={setName}
          autoComplete="name"
          textContentType="name"
          maxLength={80}
        />
        <TextField
          label={t('interface:authModal.fields.email')}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
        />
        <TextField
          label={t('interface:authModal.fields.password')}
          helper={t('auth.signUp.passwordHelper')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
        />
        {error ? (
          <Text className="text-danger" accessibilityLiveRegion="polite" testID="auth-error">
            {error}
          </Text>
        ) : null}
        <Button label={t('auth.signUp.submit')} size="lg" loading={busy} onPress={submit} />
        <View className="items-center">
          <Link href="/(auth)/sign-in" asChild>
            <Text className="text-primary">{t('auth.signUp.haveAccount')}</Text>
          </Link>
        </View>
      </ScrollView>
    </Screen>
  );
}
