import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/ui/components/Text';
import { hitTarget } from '@/ui/tokens';

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
