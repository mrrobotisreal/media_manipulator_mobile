import { useTranslation } from 'react-i18next';
import { Num } from '@/ui/components/Text';
import { formatNumber } from '@/lib/format';
import type { QuotaMetric } from '@/tools/types';
import { useAllowance } from './useAllowance';

/** One line under the tool title: what is left today for this tool's metric. Nothing for `null`. */
export function QuotaChip({ metric }: { metric: QuotaMetric | null }) {
  const { t } = useTranslation();
  const view = useAllowance();
  const a = metric ? view[metric] : null;
  if (!metric || !a || a.unlimited) return null;
  const limit = formatNumber(a.limit);
  const text =
    a.remaining <= 0
      ? t(`interface:quotaChip.${metric}.empty`, { limit })
      : t(`interface:quotaChip.${metric}.remaining`, {
          remaining: formatNumber(a.remaining),
          limit,
        });
  return (
    <Num
      testID="quota-chip"
      className={`text-sm ${a.remaining <= 0 ? 'text-primary' : 'text-muted-fg'}`}
    >
      {text}
    </Num>
  );
}
