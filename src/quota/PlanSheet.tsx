import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useGetTiersQuery } from '@/api/endpoints/tiers';
import type { TiersResponse } from '@/api/schemas/tiers';
import { formatTimeLeft } from '@/lib/format';
import { Button } from '@/ui/components/Button';
import { QuotaMeter } from '@/ui/components/QuotaMeter';
import { Sheet } from '@/ui/components/Sheet';
import { Num, Text } from '@/ui/components/Text';
import type { TierFactKey } from './tierFacts';
import { useCurrentTier } from './useTierFacts';
import { useAllowance } from './useAllowance';
import { formatLimitValue } from './valueFormat';

/** Columns of the comparison (anonymous is skipped, ticket decision 7). */
export const PLAN_COLUMNS = ['free', 'premium', 'pro'] as const;

export const PLAN_ROWS: { key: TierFactKey; label: string }[] = [
  { key: 'opsPerDay', label: 'ops' },
  { key: 'aiOpsPerDay', label: 'aiOps' },
  { key: 'maxFileBytes', label: 'fileSize' },
  { key: 'maxVideoSeconds', label: 'videoLength' },
  { key: 'maxOutputHeight', label: 'outputHeight' },
  { key: 'resultRetentionHours', label: 'retention' },
];

/**
 * Plan & limits: tier name, both meters, reset time, then the plain Free/Premium/Pro comparison from
 * `/api/tiers`. No prices, no purchase button, no link (ADR MA-0008).
 */
export function PlanSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const tier = useCurrentTier();
  const allowance = useAllowance();
  const tiers = useGetTiersQuery(undefined, { skip: !visible });
  const list = tiers.data?.tiers;
  const known = tier && (PLAN_COLUMNS as readonly string[]).includes(tier);
  const tierLabel = tier
    ? t(
        `quota.tiers.${tier === 'anonymous' ? 'free' : known || tier === 'operator' ? tier : 'free'}`,
      )
    : '';
  const time = allowance.resetsAt
    ? formatTimeLeft(allowance.resetsAt, undefined, allowance.now)
    : '';

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View className="gap-3" testID="plan-sheet">
        <Text className="text-lg font-semibold">{t('quota.planSheet.title')}</Text>
        <View className="flex-row items-center justify-between">
          <Text className="text-muted-fg">{t('quota.planSheet.current')}</Text>
          <Text className="font-semibold" testID="plan-current-tier">
            {tierLabel}
          </Text>
        </View>
        <View className="flex-row gap-4">
          <View className="flex-1">{meter('ops', allowance.ops, allowance.pending)}</View>
          <View className="flex-1">{meter('ai_ops', allowance.ai_ops, allowance.pending)}</View>
        </View>
        {time ? (
          <Text className="text-sm text-muted-fg">{t('quota.resetsIn', { time })}</Text>
        ) : null}

        {list ? (
          <PlanTable list={list} tier={tier} />
        ) : (
          <Text className="text-sm text-muted-fg">
            {tiers.isError ? t('quota.planSheet.loadFailed') : t('quota.planSheet.loading')}
          </Text>
        )}

        <Text className="text-xs text-subtle">{t('quota.planSheet.managed')}</Text>
        <Button label={t('quota.ok')} variant="secondary" onPress={onClose} />
      </View>
    </Sheet>
  );
}

function meter(
  metric: 'ops' | 'ai_ops',
  a: ReturnType<typeof useAllowance>['ops'],
  pending: boolean,
) {
  return a ? (
    <QuotaMeter metric={metric} used={a.used} limit={a.unlimited ? -1 : a.limit} />
  ) : (
    <QuotaMeter metric={metric} used={0} limit={0} pending={pending} />
  );
}

/** The plain Free/Premium/Pro comparison (facts from `/api/tiers`; no prices, no buttons). Shared with the Account plan card. */
export function PlanTable({ list, tier }: { list: TiersResponse['tiers']; tier: string | null }) {
  const { t } = useTranslation();
  return (
    <View className="rounded-lg border border-edge" testID="plan-table">
      <View className="flex-row border-b border-edge px-3 py-2">
        <View className="flex-[1.6]" />
        {PLAN_COLUMNS.map((c) => (
          <View
            key={c}
            className={`flex-1 items-end ${tier === c ? 'rounded-sm bg-surface-3' : ''}`}
            testID={tier === c ? 'plan-col-current' : `plan-col-${c}`}
            accessibilityState={{ selected: tier === c }}
          >
            <Text className="text-xs font-semibold">{t(`quota.tiers.${c}`)}</Text>
          </View>
        ))}
      </View>
      {PLAN_ROWS.map((row) => (
        <View key={row.key} className="flex-row items-center px-3 py-2">
          <Text className="flex-[1.6] pe-2 text-xs text-muted-fg">
            {t(`quota.rows.${row.label}`)}
          </Text>
          {PLAN_COLUMNS.map((c) => {
            const v = list.find((x) => x.tier === c)?.limits[row.key];
            return (
              <View key={c} className="flex-1 items-end">
                <Num className="text-xs">
                  {v === undefined ? '—' : formatLimitValue(row.key, v)}
                </Num>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}
