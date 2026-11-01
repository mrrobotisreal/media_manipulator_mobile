import { Pressable, View } from 'react-native';
import { hitTarget } from '../tokens';
import { Text } from './Text';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View
      accessibilityRole="tablist"
      testID="segmented"
      className="flex-row rounded-md border border-edge bg-surface-2 p-0.5"
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(o.value)}
            className={`flex-1 items-center justify-center rounded-sm ${selected ? 'bg-surface-3' : ''}`}
            style={{ minHeight: hitTarget - 4 }}
          >
            <Text className={selected ? 'font-semibold' : 'text-muted-fg'}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
