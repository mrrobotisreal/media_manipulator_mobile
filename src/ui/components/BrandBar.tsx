import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Wordmark } from './Wordmark';

/**
 * Small brand bar for the tab screens: the aperture mark and "Media Manipulator", nothing to tap.
 * Pads by the status-bar inset itself, so screens under it use `Screen` with `edges="none"`.
 */
export function BrandBar() {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="border-b border-edge bg-surface-0 px-4 pb-2"
      style={{ paddingTop: insets.top + 8 }}
      accessibilityRole="header"
      testID="brand-bar"
    >
      <Wordmark size="xs" />
    </View>
  );
}
