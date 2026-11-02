import { Pressable, View } from 'react-native';
import { hitTarget } from '../tokens';
import { Num, Text } from './Text';

/** -/+ stepper with a numeric readout. Values are clamped to [min, max]. */
export function Stepper({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)));
  const btn = 'items-center justify-center rounded-md border border-edge-control bg-surface-2';
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text className="flex-1 text-sm text-muted-fg">{label}</Text>
      <View className="flex-row items-center gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label} −`}
          disabled={value <= min}
          onPress={() => set(value - step)}
          className={`${btn} ${value <= min ? 'opacity-40' : ''}`}
          style={{ width: hitTarget, height: hitTarget }}
        >
          <Text>−</Text>
        </Pressable>
        <Num className="min-w-[56px] text-center" accessibilityLabel={label}>
          {format ? format(value) : String(value)}
        </Num>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label} +`}
          disabled={value >= max}
          onPress={() => set(value + step)}
          className={`${btn} ${value >= max ? 'opacity-40' : ''}`}
          style={{ width: hitTarget, height: hitTarget }}
        >
          <Text>+</Text>
        </Pressable>
      </View>
    </View>
  );
}
