import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { formatTimeLeft } from '@/lib/format';
import { useAccountLimitsFull } from '@/quota/useAccountLimitsFull';
import { useAllowance } from '@/quota/useAllowance';
import { formatLimitValue } from '@/quota/valueFormat';
import type { TierFactKey } from '@/quota/tierFacts';
import { Num, QuotaMeter, Text } from '@/ui/components';
import { Card } from './ui';

const LIMIT_ROWS: { key: TierFactKey; label: string }[] = [
  { key: 'maxFileBytes', label: 'fileSize' },
  { key: 'maxVideoSeconds', label: 'videoLength' },
  { key: 'maxOutputHeight', label: 'outputHeight' },
  { key: 'resultRetentionHours', label: 'retention' },
];

/** Usage: both daily meters, the reset countdown, then the plan limits as mono rows. `export` (Darkroom) is not shown. */
export function UsageCard() {
  const { t } = useTranslation();
  const a = useAllowance();
  const limits = useAccountLimitsFull();
  const time = a.resetsAt ? formatTimeLeft(a.resetsAt, undefined, a.now) : '';
  const meter = (metric: 'ops' | 'ai_ops', v: typeof a.ops) =>
    v ? (
      <QuotaMeter metric={metric} used={v.used} limit={v.unlimited ? -1 : v.limit} />
    ) : (
      <QuotaMeter metric={metric} used={0} limit={0} pending={a.pending} />
    );
  return (
    <Card testID="usage-card">
      <View className="flex-row gap-4">
        <View className="flex-1">{meter('ops', a.ops)}</View>
        <View className="flex-1">{meter('ai_ops', a.ai_ops)}</View>
      </View>
      {time ? <Text className="text-xs text-muted-fg">{t('quota.resetsIn', { time })}</Text> : null}
      {limits ? (
        <View className="gap-1 border-t border-edge pt-3">
          <Text className="pb-1 text-sm font-medium text-muted-fg">
            {t('account.usage.limits')}
          </Text>
          {LIMIT_ROWS.map((r) => (
            <View key={r.key} className="min-h-[32px] flex-row items-center justify-between gap-3">
              <Text className="flex-1 text-sm text-muted-fg">{t(`quota.rows.${r.label}`)}</Text>
              <Num className="text-sm">{formatLimitValue(r.key, limits[r.key] as number)}</Num>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}
