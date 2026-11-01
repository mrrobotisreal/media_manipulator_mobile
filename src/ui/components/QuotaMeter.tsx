import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { formatNumber } from '@/lib/format';
import { colors } from '../tokens';
import { Num, Text } from './Text';

export type QuotaTone = 'data' | 'premium' | 'primary' | 'muted';

/** Mirrors media-manipulator-ui/components/account/quota-meter.tsx toneFor(). */
export function quotaTone(used: number, limit: number): QuotaTone {
  if (limit <= 0) return 'muted';
  const ratio = used / limit;
  if (ratio >= 1) return 'primary';
  if (ratio >= 0.6) return 'premium';
  return 'data';
}

const TONE_COLOR: Record<QuotaTone, string> = {
  data: colors.data,
  premium: colors.premium,
  primary: colors.primary,
  muted: colors.mutedFg,
};

export interface QuotaMeterProps {
  metric?: 'ops' | 'ai_ops';
  used: number;
  /** `<= 0` is the API's "no daily limit": shows the infinity sign and no fill. */
  limit: number;
  /** Allowance not known yet: a same-size "— / —" skeleton. */
  pending?: boolean;
}

/** Daily allowance readout (mono numerals) over a 2 pt bar. The bar fills from the start edge. */
export function QuotaMeter({ metric = 'ops', used, limit, pending }: QuotaMeterProps) {
  const { t } = useTranslation();
  const label = t(
    metric === 'ai_ops' ? 'interface:quotaMeter.aiLabel' : 'interface:quotaMeter.label',
  );
  const unlimited = !pending && limit <= 0;
  const tone = pending ? 'muted' : quotaTone(used, limit);
  const ratio = pending || unlimited ? 0 : Math.min(1, used / limit);
  const readout = pending
    ? t('interface:quotaMeter.readout', {
        used: t('interface:quotaMeter.empty'),
        limit: t('interface:quotaMeter.empty'),
      })
    : unlimited
      ? '∞'
      : t('interface:quotaMeter.readout', {
          used: formatNumber(used),
          limit: formatNumber(limit),
        });
  const a11y = pending
    ? label
    : unlimited
      ? t('accessibility:quotaMeter.gaugeUnlimited')
      : metric === 'ai_ops'
        ? t('accessibility:quotaMeter.aiGauge', { label, used, limit })
        : t('accessibility:quotaMeter.gauge', { used, limit });
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={a11y}
      accessibilityValue={pending || unlimited ? undefined : { min: 0, max: limit, now: used }}
      testID={pending ? 'quota-meter-pending' : `quota-meter-${tone}`}
    >
      <Text className="text-xs text-muted-fg">{label}</Text>
      <Num className="text-sm" style={{ color: TONE_COLOR[tone] }}>
        {readout}
      </Num>
      <View className="mt-1 h-0.5 rounded-xs bg-edge">
        <View
          style={{
            height: 2,
            width: `${ratio * 100}%`,
            backgroundColor: TONE_COLOR[tone],
            alignSelf: 'flex-start',
          }}
        />
      </View>
    </View>
  );
}
