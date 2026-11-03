import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { runAccountDeletion, finishAccountDeletion } from '@/account/deleteAccount';
import { realDeleteAccountDeps, realFinishDeps } from '@/account/realDeps';
import { openWebPage } from '@/account/openWeb';
import { Card, ScreenHeader } from '@/account/ui';
import { ReauthSheet } from '@/auth/ui/ReauthSheet';
import { useActiveLocale } from '@/i18n/useActiveLocale';
import { DELETE_ACCOUNT_WEB_PATH, DELETE_ACCOUNT_WEB_PATH_LIVE, webUrl } from '@/lib/webUrl';
import { Button, Screen, Text, TextField } from '@/ui/components';

const PHRASE = 'DELETE MY ACCOUNT';
type Phase = 'idle' | 'working' | 'incomplete' | 'failed' | 'done';

export default function DeleteAccountScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const locale = useActiveLocale();
  const [typed, setTyped] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [reauthOpen, setReauthOpen] = useState(false);
  const [resolveReauth, setResolveReauth] = useState<((ok: boolean) => void) | null>(null);

  // The re-auth sheet is a promise the flow awaits: onDone -> true, closing it -> false.
  const askReauth = () =>
    new Promise<boolean>((resolve) => {
      setResolveReauth(() => resolve);
      setReauthOpen(true);
    });
  const answer = (ok: boolean) => {
    setReauthOpen(false);
    resolveReauth?.(ok);
    setResolveReauth(null);
  };

  const start = async () => {
    setPhase('working');
    const outcome = await runAccountDeletion(
      realDeleteAccountDeps(askReauth, () => finishAccountDeletion(realFinishDeps())),
    );
    setPhase(
      outcome.status === 'done'
        ? 'done'
        : outcome.status === 'incomplete'
          ? 'incomplete'
          : outcome.status === 'failed'
            ? 'failed'
            : 'idle',
    );
  };

  if (phase === 'done') {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center gap-4 px-8" testID="account-deleted">
          <Text className="text-center text-xl font-semibold">
            {t('account.deleteAccount.doneTitle')}
          </Text>
          <Text className="text-center text-muted-fg">{t('account.deleteAccount.doneBody')}</Text>
          <Button
            label={t('account.deleteAccount.toSignIn')}
            onPress={() => router.replace('/(auth)/sign-in')}
          />
        </View>
      </Screen>
    );
  }

  const busy = phase === 'working';
  return (
    <Screen edges="none">
      <ScreenHeader title={t('account.deleteAccount.title')} />
      <ScrollView contentContainerClassName="gap-3 px-4 pb-8" keyboardShouldPersistTaps="handled">
        <Card>
          <Text className="text-lg font-semibold">{t('account.deleteAccount.heading')}</Text>
          <Text className="text-muted-fg">{t('account.deleteAccount.intro')}</Text>
          {(['files', 'settings', 'subscription', 'analytics', 'signIn'] as const).map((k) => (
            <Text key={k} className="text-sm">
              {'• '}
              {t(`account.deleteAccount.consequences.${k}`)}
            </Text>
          ))}
        </Card>
        <Card>
          <TextField
            label={t('account.deleteAccount.typedLabel', { phrase: PHRASE })}
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!busy}
          />
          <Text className="text-xs text-subtle">{t('account.deleteAccount.reauthHint')}</Text>
          {phase === 'incomplete' ? (
            <Text className="text-premium" testID="deletion-incomplete">
              {t('account.deleteAccount.incomplete')}
            </Text>
          ) : null}
          {phase === 'failed' ? (
            <Text className="text-danger">{t('account.deleteAccount.failed')}</Text>
          ) : null}
          <Button
            label={
              phase === 'incomplete'
                ? t('account.deleteAccount.retry')
                : busy
                  ? t('account.deleteAccount.working')
                  : t('account.deleteAccount.cta')
            }
            variant="danger"
            loading={busy}
            disabled={typed.trim() !== PHRASE}
            onPress={() => void start()}
          />
          {DELETE_ACCOUNT_WEB_PATH_LIVE ? (
            <Button
              label={t('account.deleteAccount.webLink')}
              variant="ghost"
              onPress={() => void openWebPage(webUrl(DELETE_ACCOUNT_WEB_PATH, locale))}
            />
          ) : null}
        </Card>
      </ScrollView>
      <ReauthSheet visible={reauthOpen} onClose={() => answer(false)} onDone={() => answer(true)} />
    </Screen>
  );
}
