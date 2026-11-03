import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PlanCard } from '@/account/PlanCard';
import { signOutEverywhere, realSignOutEverywhereDeps } from '@/account/security';
import { Card, NavRow, SectionLabel } from '@/account/ui';
import { UsageCard } from '@/account/UsageCard';
import { EVENTS } from '@/analytics/events';
import { track } from '@/analytics/track';
import { useAccountMeQuery } from '@/api/useAccountMe';
import { performSignOut } from '@/auth/signOut';
import { useActiveLocale } from '@/i18n/useActiveLocale';
import { webUrl, PRIVACY_PATH, TERMS_PATH } from '@/lib/webUrl';
import { useAppDispatch } from '@/state/hooks';
import { Button, Screen, Sheet, Text } from '@/ui/components';
import { showNotice } from '@/ui/notice';
import { openWebPage } from '@/account/openWeb';

/** Catalog `status` values the app can derive from `/account/me` (web `billingState`, subscription users only). */
function subscriptionStatus(
  status: string | undefined,
  cancelAtPeriodEnd: boolean,
): 'active' | 'past_due' | 'cancel_at_period_end' {
  if (status === 'past_due' || status === 'unpaid') return 'past_due';
  return cancelAtPeriodEnd ? 'cancel_at_period_end' : 'active';
}

export default function AccountOverview() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const locale = useActiveLocale();
  const me = useAccountMeQuery();
  const [sheet, setSheet] = useState<'signOut' | 'everywhere' | null>(null);
  const [busy, setBusy] = useState(false);
  const data = me.data;
  const tier = data?.tier ?? null;
  const user = data?.user;

  const subscription = user?.tierSource === 'subscription';
  const status = user ? subscriptionStatus(user.subscriptionStatus, user.cancelAtPeriodEnd) : null;
  const interval = user?.billingInterval;
  // `subscription_status_viewed` once per focus of the overview, subscription users only (web: billing-panel).
  useFocusEffect(
    useCallback(() => {
      if (subscription && status) {
        track(EVENTS.SUBSCRIPTION_STATUS_VIEWED, { status, interval: interval ?? 'none' });
      }
    }, [subscription, status, interval]),
  );

  const everywhere = async () => {
    setBusy(true);
    const result = await signOutEverywhere(realSignOutEverywhereDeps(dispatch));
    setBusy(false);
    setSheet(null);
    if (result === 'failed') showNotice(t('account.security.signOutEverywhereFailed'), 'error');
  };

  return (
    <Screen edges="none">
      <ScrollView contentContainerClassName="gap-2 px-4 pb-8 pt-2">
        <SectionLabel>{t('account.sections.plan')}</SectionLabel>
        {tier ? (
          <PlanCard tier={tier} user={user} />
        ) : (
          <Card>
            <Text className="text-muted-fg">
              {me.isError ? t('account.plan.loadFailed') : t('account.plan.loading')}
            </Text>
          </Card>
        )}

        <SectionLabel>{t('account.sections.usage')}</SectionLabel>
        <UsageCard />

        <SectionLabel>{t('account.sections.settings')}</SectionLabel>
        <View className="gap-2">
          <NavRow label={t('account.retention.title')} href="/(app)/(tabs)/account/retention" />
          <NavRow
            label={t('account.notifications.title')}
            href="/(app)/(tabs)/account/notifications"
          />
          <NavRow label={t('language.title')} href="/(app)/(tabs)/account/language" />
        </View>

        <SectionLabel>{t('account.sections.privacy')}</SectionLabel>
        <NavRow label={t('account.privacy.title')} href="/(app)/(tabs)/account/privacy" />

        <SectionLabel>{t('account.sections.security')}</SectionLabel>
        <View className="gap-2">
          <NavRow label={t('common.signOut')} onPress={() => setSheet('signOut')} />
          <NavRow
            label={t('account.security.signOutEverywhere')}
            onPress={() => setSheet('everywhere')}
          />
        </View>

        <SectionLabel>{t('account.sections.legal')}</SectionLabel>
        <View className="gap-2">
          <NavRow
            label={t('account.legal.privacy')}
            onPress={() => void openWebPage(webUrl(PRIVACY_PATH, locale))}
          />
          <NavRow
            label={t('account.legal.terms')}
            onPress={() => void openWebPage(webUrl(TERMS_PATH, locale))}
          />
        </View>

        <SectionLabel>{t('account.sections.about')}</SectionLabel>
        <NavRow label={t('account.about.title')} href="/(app)/(tabs)/account/about" />
      </ScrollView>

      <Sheet visible={sheet === 'signOut'} onClose={() => setSheet(null)}>
        <View className="gap-3">
          <Text className="text-lg font-semibold">{t('auth.signOut.confirmTitle')}</Text>
          <Text className="text-muted-fg">{t('auth.signOut.confirmBody')}</Text>
          <Button
            label={t('common.signOut')}
            variant="danger"
            onPress={() => {
              setSheet(null);
              void performSignOut(dispatch);
            }}
          />
          <Button label={t('common.cancel')} variant="ghost" onPress={() => setSheet(null)} />
        </View>
      </Sheet>
      <Sheet visible={sheet === 'everywhere'} onClose={() => !busy && setSheet(null)}>
        <View className="gap-3">
          <Text className="text-lg font-semibold">
            {t('account.security.signOutEverywhereTitle')}
          </Text>
          <Text className="text-muted-fg">{t('account.security.signOutEverywhereBody')}</Text>
          <Button
            label={t('account.security.signOutEverywhere')}
            variant="danger"
            loading={busy}
            onPress={() => void everywhere()}
          />
          <Button
            label={t('common.cancel')}
            variant="ghost"
            disabled={busy}
            onPress={() => setSheet(null)}
          />
        </View>
      </Sheet>
    </Screen>
  );
}
