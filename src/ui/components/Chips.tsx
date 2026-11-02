import { Pressable, View } from 'react-native';
import { hitTarget } from '../tokens';
import { Text } from './Text';

export interface ChipOption<T extends string | number> {
  value: T;
  label: string;
}

/** Wrapping chip row. Single-select via `Chips`, multi-select via `MultiChips`. */
export function Chips<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: ChipOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  label?: string;
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
}: {
  options: ChipOption<T>[];
  value: T[];
  onToggle: (value: T) => void;
  label?: string;
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
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  role: 'radio' | 'checkbox';
}) {
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityState={role === 'radio' ? { selected } : { checked: selected }}
      onPress={onPress}
      className={`items-center justify-center rounded-md border px-3 ${
        selected ? 'border-primary bg-surface-3' : 'border-edge-control bg-surface-2'
      }`}
      style={{ minHeight: hitTarget }}
    >
      <Text className={selected ? 'font-semibold' : 'text-muted-fg'}>{label}</Text>
    </Pressable>
  );
}
