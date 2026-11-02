import { Pressable, View } from 'react-native';
import { hitTarget } from '../tokens';
import { Text } from './Text';

export interface ChipOption<T extends string | number> {
  value: T;
  label: string;
  /** Additive (MA19): greyed and not pressable (plan limits). */
  disabled?: boolean;
}

/** Wrapping chip row. Single-select via `Chips`, multi-select via `MultiChips`. */
export function Chips<T extends string | number>({
  options,
  value,
  onChange,
  label,
  testIDPrefix,
}: {
  options: ChipOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  label?: string;
  testIDPrefix?: string;
}) {
  return (
    <View accessibilityLabel={label} className="flex-row flex-wrap gap-2">
      {options.map((o) => (
        <Chip
          key={String(o.value)}
          label={o.label}
          selected={o.value === value}
          onPress={() => onChange(o.value)}
          role="radio"
          disabled={o.disabled}
          testID={testIDPrefix ? `${testIDPrefix}-${o.value}` : undefined}
        />
      ))}
    </View>
  );
}

export function MultiChips<T extends string | number>({
  options,
  value,
  onToggle,
  label,
  testIDPrefix,
}: {
  options: ChipOption<T>[];
  value: T[];
  onToggle: (value: T) => void;
  label?: string;
  testIDPrefix?: string;
}) {
  return (
    <View accessibilityLabel={label} className="flex-row flex-wrap gap-2">
      {options.map((o) => (
        <Chip
          key={String(o.value)}
          label={o.label}
          selected={value.includes(o.value)}
          onPress={() => onToggle(o.value)}
          role="checkbox"
          disabled={o.disabled}
          testID={testIDPrefix ? `${testIDPrefix}-${o.value}` : undefined}
        />
      ))}
    </View>
  );
}

function Chip({
  label,
  selected,
  onPress,
  role,
  disabled,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  role: 'radio' | 'checkbox';
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole={role}
      disabled={disabled}
      accessibilityState={{
        ...(role === 'radio' ? { selected } : { checked: selected }),
        disabled: Boolean(disabled),
      }}
      onPress={onPress}
      className={`items-center justify-center rounded-md border px-3 ${
        selected ? 'border-primary bg-surface-3' : 'border-edge-control bg-surface-2'
      } ${disabled ? 'opacity-40' : ''}`}
      style={{ minHeight: hitTarget }}
    >
      <Text className={selected ? 'font-semibold' : 'text-muted-fg'}>{label}</Text>
    </Pressable>
  );
}
