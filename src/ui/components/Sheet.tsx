import type { ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';

/** Bottom sheet on RN Modal. Drag-free in v1; backdrop tap dismisses. */
export function Sheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/60" onPress={onClose} accessibilityLabel="Close" />{' '}
      {/* i18n: MA05 */}
      <View className="rounded-t-xl border-t border-edge bg-surface-1 p-4">{children}</View>
    </Modal>
  );
}
