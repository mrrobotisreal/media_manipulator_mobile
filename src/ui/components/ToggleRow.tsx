import { Switch, View } from 'react-native';
import { colors } from '../tokens';
import { Text } from './Text';

/** Label on the start side, switch on the end side (logical, flips in RTL). */
export function ToggleRow({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View className="flex-row items-center gap-3" style={{ minHeight: 44 }}>
      <View className="flex-1">
        <Text>{label}</Text>
        {hint ? <Text className="text-sm text-subtle">{hint}</Text> : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: colors.surface3, true: colors.data }}
        thumbColor={colors.foreground}
      />
    </View>
  );
}
