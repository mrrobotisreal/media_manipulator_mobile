import type { ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

/**
 * Bottom sheet on RN Modal. Drag-free in v1; backdrop tap dismisses. Edge-to-edge (Android 15+ draws
 * under the navigation bar), so the panel pads by the bottom inset or its last button sits under Home.
 * An RN Modal is its own native window on Android, outside the app's root GestureHandlerRootView, so
 * the sheet needs its own root or every gesture-handler control inside it (Slider pans, double-tap
 * resets) never receives touches.
 */
export function Sheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <GestureHandlerRootView style={{ flex: 1 }} testID="sheet-gesture-root">
        <Pressable
          className="flex-1 bg-black/60"
          onPress={onClose}
          accessibilityLabel={t('common.close')}
        />
        <View
          className="rounded-t-xl border-t border-edge bg-surface-1 p-4"
          style={{ paddingBottom: 16 + insets.bottom }}
          testID="sheet-panel"
        >
          {children}
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}
