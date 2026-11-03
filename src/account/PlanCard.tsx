import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { AccountUser } from '@/api/schemas/account';
import { formatDateTime } from '@/lib/format';
import { Text } from '@/ui/components';
import { PlanTable } from '@/quota/PlanSheet';
import { useTierList } from '@/quota/useTierFacts';
import { tierOf } from '@/api/schemas/tier';
import { Card } from './ui';

export type PlanKind = 'subscription' | 'grant' | 'operator' | 'free';

/** Which card variant `GET /account/me` selects (ticket decision 4). */
export function planKind(
  tier: string,
  user: Pick<AccountUser, 'tierSource'> | undefined,
): PlanKind {
  if (tier === 'operator') return 'operator';
  const source = user?.tierSource;
  if (source === 'subscription') return 'subscription';
  if (source === 'manual_grant') return 'grant';
  // A paid tier from an unknown source still reads as "managed on the web".
  if (tier === 'premium' || tier === 'pro') return 'subscription';
  return 'free';
}

const PAST_DUE = new Set(['past_due', 'unpaid']);

/**
 * Plan card. MA-0008: plain text only. No purchase button, no checkout/portal link, no URL to the
 * web pricing page and no steering copy; the card renders nothing pressable.
 */
export function PlanCard({ tier, user }: { tier: string; user: AccountUser | undefined }) {
  const { t } = useTranslation();
  const tiers = useTierList();
  const kind = planKind(tier, user);
  const known = tierOf(tier);
  const tierLabel = t(`quota.tiers.${known === 'anonymous' ? 'free' : known}`);
  const date = (iso?: string) => (iso ? formatDateTime(iso, 'date') : '');

  return (
    <Card testID="plan-card">
      {kind === 'subscription' ? (
        <>
          <Text className="font-semibold">
            {t('account.plan.managedOnWeb', { tier: tierLabel })}
          </Text>
          {user?.cancelAtPeriodEnd && user.tierExpiresAt ? (
            <Text className="text-sm text-muted-fg">
              {t('account.plan.endsOn', { date: date(user.tierExpiresAt) })}
            </Text>
          ) : null}
          {user?.subscriptionStatus && PAST_DUE.has(user.subscriptionStatus) ? (
            <Text className="text-sm text-premium">{t('account.plan.pastDue')}</Text>
          ) : null}
        </>
      ) : null}
      {kind === 'grant' ? (
        <>
          <Text className="font-semibold">{t('account.plan.granted', { tier: tierLabel })}</Text>
          {user?.tierExpiresAt ? (
            <Text className="text-sm text-muted-fg">
              {t('account.plan.until', { date: date(user.tierExpiresAt) })}
            </Text>
          ) : null}
        </>
      ) : null}
      {kind === 'operator' ? (
        <Text className="font-semibold">{t('account.plan.operator')}</Text>
      ) : null}
      {kind === 'free' ? (
        <>
          <Text className="font-semibold">{tierLabel}</Text>
          <Text className="text-sm text-muted-fg">{t('account.plan.freeBody')}</Text>
          {tiers ? (
            <View>
              <PlanTable list={tiers} tier={tier} />
            </View>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}
