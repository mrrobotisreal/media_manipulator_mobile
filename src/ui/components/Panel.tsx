import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Text } from './Text';

export function Panel({
  title,
  children,
  className = '',
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <View className={`rounded-lg border border-edge bg-surface-1 p-4 ${className}`}>
      {title ? <Text className="mb-2 text-sm font-medium text-muted-fg">{title}</Text> : null}
      {children}
    </View>
  );
}
