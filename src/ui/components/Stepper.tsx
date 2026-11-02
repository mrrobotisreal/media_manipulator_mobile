import { View } from 'react-native';
import { Button } from './Button';
import { Num } from './Text';

const round = (n: number, step: number) => {
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)) + 1);
  return Number(n.toFixed(decimals));
};

/** - value + with min/max/step. The value is a mono readout; `format` customises it. */
export function Stepper({
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  decrementLabel,
  incrementLabel,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  decrementLabel: string;
  incrementLabel: string;
}) {
  const set = (n: number) => onChange(round(Math.min(max, Math.max(min, n)), step));
  return (
    <View className="flex-row items-center gap-3" testID="stepper">
      <Button
        variant="secondary"
        label="−"
        accessibilityLabel={decrementLabel}
        disabled={value <= min}
        onPress={() => set(value - step)}
      />
      <Num className="min-w-16 text-center text-lg" testID="stepper-value">
        {format ? format(value) : String(value)}
      </Num>
      <Button
        variant="secondary"
        label="+"
        accessibilityLabel={incrementLabel}
        disabled={value >= max}
        onPress={() => set(value + step)}
      />
    </View>
  );
}
