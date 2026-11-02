import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Text } from './Text';

/** Label + control + optional hint/error line. Family-neutral form row. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label?: string;
  hint?: string | null;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <View className="gap-2">
      {label ? <Text className="text-sm text-muted-fg">{label}</Text> : null}
      {children}
      {error ? (
        <Text className="text-sm text-danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text className="text-sm text-subtle">{hint}</Text>
      ) : null}
    </View>
  );
}
