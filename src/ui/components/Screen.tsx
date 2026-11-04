import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Pads for the system bars. Tab screens use `edges="none"`: the tabs' BrandBar pads the status bar and
 * the tab bar pads the gesture/navigation bar, so padding again leaves a gap above the tabs.
 */
export function Screen({
  children,
  className = '',
  edges = 'both',
}: {
  children: ReactNode;
  className?: string;
  edges?: 'both' | 'none';
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className={`flex-1 bg-surface-0 ${className}`}
      style={
        edges === 'both' ? { paddingTop: insets.top, paddingBottom: insets.bottom } : undefined
      }
    >
      {children}
    </View>
  );
}
