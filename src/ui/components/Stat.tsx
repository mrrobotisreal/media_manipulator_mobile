import { View } from 'react-native';
import { Num, Text } from './Text';

export function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string | number;
  unit?: string;
}) {
  return (
    <View>
      <Text className="text-xs uppercase text-muted-fg">{label}</Text>
      <View className="flex-row items-baseline gap-1">
        <Num className="text-xl font-medium">{value}</Num>
        {unit ? <Text className="text-sm text-muted-fg">{unit}</Text> : null}
      </View>
    </View>
  );
}
