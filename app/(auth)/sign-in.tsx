import { Link, Redirect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { trackAuthScreenShown } from '@/auth/analytics';
import { authErrorI18nKey, errorEmail } from '@/auth/errors';
import { isFirebaseConfigured } from '@/lib/firebaseAvailable';
import {
  signInWithApple,
  signInWithEmailFlow,
  signInWithGoogle,
  type SignInOutcome,
} from '@/auth/signIn';
import { LinkSheet } from '@/auth/ui/LinkSheet';
import { ProviderButtons } from '@/auth/ui/ProviderButtons';
import { PRIVACY_URL, TERMS_URL } from '@/lib/links';
import { useAppDispatch, useAppSelector } from '@/state/hooks';
import { noticeSet } from '@/state/slices/auth';
import { Button, Screen, Text, TextField, Wordmark, KeyboardScroll } from '@/ui/components';
import { isValidEmail } from '@/auth/email';
import type { AuthMethod } from '@/auth/methods';

export default function SignIn() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const status = useAppSelector((s) => s.auth.status);
  const notice = useAppSelector((s) => s.auth.notice);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [linkEmail, setLinkEmail] = useState<string | undefined>();
  const available = isFirebaseConfigured();

  useEffect(() => {
    if (available) trackAuthScreenShown('signin');
  }, [available]);

  if (status === 'ready') return <Redirect href="/(app)/(tabs)" />;
  if (status === 'syncFailed') return <Redirect href="/(auth)/sync-failed" />;

  const handle = (outcome: SignInOutcome) => {
    setBusy(false);
    if (outcome.status === 'error') setError(t(authErrorI18nKey(outcome.errorKey)));
    else if (outcome.status === 'link') setLinkEmail(outcome.email ?? errorEmail(undefined));
    else {
      setError(null);
      if (notice === 'sessionExpired') dispatch(noticeSet(null));
    }
  };
  const run = (fn: () => Promise<SignInOutcome>) => {
    setBusy(true);
    setError(null);
    void fn().then(handle);
  };

  const pickLinkMethod = (method: AuthMethod) => {
    // The linking sheet only needs the user to sign in with the other method; the pending link completes after.
    if (method === 'email') setEmailOpen(true);
    else if (method === 'google') run(() => signInWithGoogle('signin', dispatch));
    else run(() => signInWithApple('signin', dispatch));
  };

  return (
    <Screen>
      <KeyboardScroll contentContainerClassName="grow justify-center gap-5 px-6 py-8">
        <Wordmark />
        <View className="gap-1">
          <Text className="text-xl font-semibold">{t('auth.signIn.title')}</Text>
          <Text className="text-muted-fg">{t('auth.signIn.subtitle')}</Text>
        </View>
        {notice === 'sessionExpired' ? (
          <Text className="text-premium" testID="session-expired">
            {t('auth.signIn.sessionExpired')}
          </Text>
        ) : null}
        {available ? (
          <>
            <ProviderButtons
              disabled={busy}
              onApple={() => run(() => signInWithApple('signin', dispatch))}
              onGoogle={() => run(() => signInWithGoogle('signin', dispatch))}
            />
            {emailOpen ? (
              <View className="gap-3">
                <TextField
                  testID="auth-email"
                  label={t('interface:authModal.fields.email')}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  textContentType="emailAddress"
                />
                <TextField
                  testID="auth-password"
                  label={t('interface:authModal.fields.password')}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoComplete="current-password"
                  textContentType="password"
                />
                <Button
                  testID="auth-submit"
                  label={t('interface:accountMenu.signIn')}
                  size="lg"
                  loading={busy}
                  disabled={!isValidEmail(email) || password.length === 0}
                  onPress={() => run(() => signInWithEmailFlow(email, password, dispatch))}
                />
              </View>
            ) : (
              <Button
                testID="auth-email-toggle"
                label={t('auth.signIn.email')}
                variant="ghost"
                size="lg"
                disabled={busy}
                onPress={() => setEmailOpen(true)}
              />
            )}
            {error ? (
              <Text className="text-danger" accessibilityLiveRegion="polite" testID="auth-error">
                {error}
              </Text>
            ) : null}
            <View className="flex-row flex-wrap justify-between gap-3">
              <Link href="/(auth)/sign-up" asChild>
                <Text className="text-primary">{t('auth.signIn.createAccount')}</Text>
              </Link>
              <Link href="/(auth)/forgot-password" asChild>
                <Text className="text-primary">{t('interface:authModal.forgotPassword')}</Text>
              </Link>
            </View>
            <Text className="text-sm text-subtle">
              {t('auth.signIn.legal', { terms: '\u0001', privacy: '\u0002' })
                .split(/(\u0001|\u0002)/)
                .map((part: string, i: number) =>
                  part === '\u0001' ? (
                    <Text
                      key={i}
                      className="text-sm text-primary"
                      onPress={() => void Linking.openURL(TERMS_URL)}
                    >
                      {t('auth.signIn.terms')}
                    </Text>
                  ) : part === '\u0002' ? (
                    <Text
                      key={i}
                      className="text-sm text-primary"
                      onPress={() => void Linking.openURL(PRIVACY_URL)}
                    >
                      {t('auth.signIn.privacy')}
                    </Text>
                  ) : (
                    part
                  ),
                )}
            </Text>
          </>
        ) : (
          <Text className="text-muted-fg" testID="auth-unavailable">
            {t('auth.signIn.unavailable')}
          </Text>
        )}
      </KeyboardScroll>
      <LinkSheet email={linkEmail} onPick={pickLinkMethod} />
    </Screen>
  );
}
