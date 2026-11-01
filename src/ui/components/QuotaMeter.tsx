import { View } from 'react-native';
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

export function QuotaMeter({
  used,
  limit,
  label,
}: {
  used: number;
  limit: number;
  label?: string;
}) {
  const tone = quotaTone(used, limit);
  const ratio = limit > 0 ? Math.min(1, used / limit) : 0;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: limit, now: used }}
      testID={`quota-meter-${tone}`}
    >
      <Num className="text-sm" style={{ color: TONE_COLOR[tone] }}>
        {used}/{limit}
      </Num>
      <View className="mt-1 h-0.5 rounded-xs bg-edge">
        <View style={{ height: 2, width: `${ratio * 100}%`, backgroundColor: TONE_COLOR[tone] }} />
      </View>
      {label ? <Text className="mt-1 text-xs text-muted-fg">{label}</Text> : null}
    </View>
  );
}
