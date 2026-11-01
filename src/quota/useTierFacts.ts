import { useTranslation } from 'react-i18next';
import { useGetTiersQuery } from '@/api/endpoints/tiers';
import { accountApi } from '@/api/endpoints/account';
import { useAppSelector } from '@/state/hooks';
import { higherTierFact, type TierFact, type TierFactKey } from './tierFacts';
import { formatLimitValue } from './valueFormat';

const FACT_KEY: Partial<Record<TierFactKey, string>> = {
  maxFileBytes: 'fileSize',
  maxVideoSeconds: 'videoLength',
  maxOutputHeight: 'outputHeight',
  opsPerDay: 'ops',
  aiOpsPerDay: 'aiOps',
  resultRetentionHours: 'retention',
};
/** `quota.rows.*` label keys (different spelling for the AI row). */
const ROW_KEY: Partial<Record<TierFactKey, string>> = { ...FACT_KEY };

export function useCurrentTier(): string | null {
  const snapshot = useAppSelector(
    (s) => accountApi.endpoints.getAccountMe.select()(s as never)?.data?.tier,
  );
  const header = useAppSelector((s) => s.quota.tier);
  return snapshot ?? header;
}

export function useTierList() {
  return useGetTiersQuery().data?.tiers;
}

/** Sentence for a fact; `null` when no higher tier raises the limit (or tiers are still loading). */
export function useFactText(limitKey: TierFactKey): string | null {
  const { t } = useTranslation();
  const tiers = useTierList();
  const tier = useCurrentTier();
  const fact = higherTierFact(limitKey, tiers, tier);
  return fact ? factText(t, fact) : null;
}

export function factText(t: (k: string, o?: Record<string, unknown>) => string, fact: TierFact) {
  const value = formatLimitValue(fact.limitKey, fact.value);
  if (fact.tiers.length === 2) {
    return t(`quota.fact.${FACT_KEY[fact.limitKey]}`, { tiers: t('quota.tierNames.both'), value });
  }
  const tierName = t(`quota.tiers.${fact.tiers[0]}`);
  return `${tierName}: ${t(`quota.rows.${ROW_KEY[fact.limitKey]}`)}: ${value}`;
}
