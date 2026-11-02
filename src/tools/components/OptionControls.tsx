import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Switch, View } from 'react-native';
import { Num, Text } from '@/ui/components/Text';
import { colors, hitTarget } from '@/ui/tokens';

/** Labelled group of controls. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View className="gap-2">
      <Text className="text-sm text-muted-fg">{label}</Text>
      {children}
    </View>
  );
}

export interface ChipOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

/** Wrapping single-select chips (radio semantics). */
export function ChipRow<T extends string>({
  options,
  value,
  onChange,
  testIDPrefix = 'chip',
}: {
  options: ChipOption<T>[];
  value: T;
  onChange: (v: T) => void;
  testIDPrefix?: string;
}) {
  return (
    <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            testID={`${testIDPrefix}-${o.value}`}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled: Boolean(o.disabled) }}
            disabled={o.disabled}
            onPress={() => onChange(o.value)}
            className={`items-center justify-center rounded-md border px-3 ${
              selected ? 'border-data bg-surface-3' : 'border-edge bg-surface-1'
            } ${o.disabled ? 'opacity-40' : ''}`}
            style={{ minHeight: hitTarget }}
          >
            <Text className={selected ? 'font-semibold' : 'text-muted-fg'}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Wrapping multi-select chips (checkbox semantics). */
export function MultiChipRow<T extends string>({
  options,
  values,
  onToggle,
  testIDPrefix = 'chip',
}: {
  options: ChipOption<T>[];
  values: readonly T[];
  onToggle: (v: T) => void;
  testIDPrefix?: string;
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {options.map((o) => {
        const checked = values.includes(o.value);
        return (
          <Pressable
            key={o.value}
            testID={`${testIDPrefix}-${o.value}`}
            accessibilityRole="checkbox"
            accessibilityState={{ checked }}
            onPress={() => onToggle(o.value)}
            className={`items-center justify-center rounded-md border px-3 ${
              checked ? 'border-data bg-surface-3' : 'border-edge bg-surface-1'
            }`}
            style={{ minHeight: hitTarget }}
          >
            <Text className={checked ? 'font-semibold' : 'text-muted-fg'}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const roundTo = (n: number, step: number) => Math.round(n / step) * step;
const clean = (n: number) => Math.round(n * 1e6) / 1e6;

/** Minus / value / plus stepper; the value text is supplied by the caller (units, locale). */
export function Stepper({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
  testID = 'stepper',
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const set = (v: number) => onChange(clean(Math.min(max, Math.max(min, roundTo(v, step)))));
  const btn = (kind: 'decrease' | 'increase') => {
    const dir = kind === 'increase' ? 1 : -1;
    const disabled = kind === 'increase' ? value >= max : value <= min;
    return (
      <Pressable
        testID={`${testID}-${kind}`}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${t(`toolUi.controls.${kind}`)}`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => set(value + dir * step)}
        className={`items-center justify-center rounded-md border border-edge-control bg-surface-2 ${
          disabled ? 'opacity-40' : ''
        }`}
        style={{ width: hitTarget, height: hitTarget }}
      >
        <Text className="text-lg font-semibold">{dir > 0 ? '+' : '−'}</Text>
      </Pressable>
    );
  };
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text className="flex-1">{label}</Text>
      {btn('decrease')}
      <Num
        testID={`${testID}-value`}
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min, max, now: value, text: display }}
        className="min-w-16 text-center"
      >
        {display}
      </Num>
      {btn('increase')}
    </View>
  );
}

export function SwitchRow({
  label,
  value,
  onChange,
  testID = 'switch',
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  testID?: string;
}) {
  return (
    <View className="flex-row items-center justify-between gap-3" style={{ minHeight: hitTarget }}>
      <Text className="flex-1">{label}</Text>
      <Switch
        testID={testID}
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.surface3, true: colors.data }}
        thumbColor={colors.foreground}
      />
    </View>
  );
}

/** Collapsible "More options" section. */
export function MoreSection({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <View className="gap-3">
      <Pressable
        testID="more-toggle"
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        className="flex-row items-center justify-between"
        style={{ minHeight: hitTarget }}
      >
        <Text className="font-semibold">{label}</Text>
        <Text className="text-muted-fg">{open ? '−' : '+'}</Text>
      </Pressable>
      {open ? <View className="gap-4">{children}</View> : null}
    </View>
  );
}
