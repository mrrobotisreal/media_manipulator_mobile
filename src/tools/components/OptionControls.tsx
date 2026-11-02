import { useState, type ReactNode } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { Text } from '@/ui/components/Text';
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
