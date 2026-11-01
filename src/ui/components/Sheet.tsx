import type { ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        className="flex-1 bg-black/60"
        onPress={onClose}
        accessibilityLabel={t('common.close')}
      />
      <View className="rounded-t-xl border-t border-edge bg-surface-1 p-4">{children}</View>
    </Modal>
  );
}
