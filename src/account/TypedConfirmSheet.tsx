import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button, Sheet, Text, TextField } from '@/ui/components';

/**
 * Typed confirmation (decision 9/10): the destructive button stays disabled until the user types the
 * exact phrase the API requires (`DELETE`, `DELETE MY ACCOUNT`). Case-sensitive, trimmed.
 */
export function TypedConfirmSheet({
  visible,
  title,
  body,
  phrase,
  confirmLabel,
  busy,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  title: string;
  body: string;
  phrase: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');
  const close = () => {
    setTyped('');
    onClose();
  };
  return (
    <Sheet visible={visible} onClose={() => !busy && close()}>
      <View className="gap-3" testID="typed-confirm">
        <Text className="text-lg font-semibold">{title}</Text>
        <Text className="text-muted-fg">{body}</Text>
        <TextField
          label={t('account.privacy.typedLabel', { phrase })}
          value={typed}
          onChangeText={setTyped}
          autoCapitalize="characters"
          autoCorrect={false}
        />
        <Button
          label={confirmLabel}
          variant="danger"
          loading={busy}
          disabled={typed.trim() !== phrase}
          onPress={() => {
            setTyped('');
            onConfirm();
          }}
        />
        <Button label={t('common.cancel')} variant="ghost" disabled={busy} onPress={close} />
      </View>
    </Sheet>
  );
}
