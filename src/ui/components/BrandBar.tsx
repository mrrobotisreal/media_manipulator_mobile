import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Wordmark } from './Wordmark';

/**
 * Small brand bar for the tab screens: the aperture mark and "Media Manipulator". Nothing to tap unless a
 * screen passes `right` (the Tools tab's Medi button, MA54).
 * Pads by the status-bar inset itself, so screens under it use `Screen` with `edges="none"`.
 */
export function BrandBar({ right }: { right?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-row items-center justify-between border-b border-edge bg-surface-0 px-4 pb-2"
      style={{ paddingTop: insets.top + 8 }}
      accessibilityRole="header"
      testID="brand-bar"
    >
      <Wordmark size="xs" />
      {right}
    </View>
  );
}
