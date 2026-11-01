import { formatBytes, formatNumber, formatRetention, formatSpan } from '@/lib/format';
import type { TierFactKey } from './tierFacts';

/** A tier-limit value as the user reads it: "5 GB", "2 hr", "1440p", "300", "7 days"; -1 is "∞". */
export function formatLimitValue(key: TierFactKey, value: number): string {
  if (value < 0) return '∞';
  switch (key) {
    case 'maxFileBytes':
      return formatBytes(value);
    case 'maxVideoSeconds':
      return formatSpan(value);
    case 'maxOutputHeight':
      return `${formatNumber(value, undefined, { useGrouping: false })}p`;
    case 'resultRetentionHours':
      return formatRetention(value);
    default:
      return formatNumber(value);
  }
}
