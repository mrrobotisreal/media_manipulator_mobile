import { Pressable, View } from 'react-native';
import { hitTarget } from '../tokens';
import { Num, Text } from './Text';

export interface Chip<T extends string | number> {
  value: T;
  label: string;
  disabled?: boolean;
}

/** Single-select chips that wrap onto several lines. Numeric labels render in mono. */
export function ChipRow<T extends string | number>({
  options,
  value,
  onChange,
  numeric = false,
}: {
  options: Chip<T>[];
  value: T | null;
  onChange: (v: T) => void;
  numeric?: boolean;
}) {
  const Label = numeric ? Num : Text;
  return (
    <View accessibilityRole="radiogroup" testID="chip-row" className="flex-row flex-wrap gap-2">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled: o.disabled }}
            disabled={o.disabled}
            onPress={() => onChange(o.value)}
            style={{ minHeight: hitTarget, minWidth: hitTarget }}
            className={`items-center justify-center rounded-md border px-3 ${
              selected ? 'border-data bg-surface-3' : 'border-edge-control bg-surface-1'
            } ${o.disabled ? 'opacity-40' : ''}`}
          >
            <Label className={selected ? 'font-semibold' : 'text-muted-fg'}>{o.label}</Label>
          </Pressable>
        );
      })}
    </View>
  );
}
