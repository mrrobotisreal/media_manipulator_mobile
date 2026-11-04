/** The 409 `revision_conflict` sheet (ticket MA50 decision 5): Keep mine / Load theirs. */
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/ui/components/Button';
import { Sheet } from '@/ui/components/Sheet';
import { Text } from '@/ui/components/Text';

export function ConflictSheet({
  visible,
  onKeepMine,
  onLoadTheirs,
  onClose,
}: {
  visible: boolean;
  onKeepMine: () => void;
  onLoadTheirs: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View className="gap-3" testID="photo-conflict-sheet">
        <Text className="text-lg font-semibold">{t('photo.conflict.title')}</Text>
        <Text className="text-muted-fg">{t('photo.conflict.body')}</Text>
        <Button
          testID="photo-conflict-keep"
          label={t('photo.conflict.keepMine')}
          onPress={onKeepMine}
        />
        <Button
          testID="photo-conflict-theirs"
          variant="secondary"
          label={t('photo.conflict.loadTheirs')}
          onPress={onLoadTheirs}
        />
      </View>
    </Sheet>
  );
}

/** "Discard unsaved changes?" on Back. */
export function UnsavedSheet({
  visible,
  onDiscard,
  onClose,
}: {
  visible: boolean;
  onDiscard: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View className="gap-3" testID="photo-unsaved-sheet">
        <Text className="text-lg font-semibold">{t('photo.unsaved')}</Text>
        <Button variant="danger" label={t('photo.discard')} onPress={onDiscard} />
        <Button variant="secondary" label={t('photo.keepEditing')} onPress={onClose} />
      </View>
    </Sheet>
  );
}

/** A recovered draft on reopen. */
export function DraftSheet({
  visible,
  onRestore,
  onDiscard,
}: {
  visible: boolean;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Sheet visible={visible} onClose={onDiscard}>
      <View className="gap-3" testID="photo-draft-sheet">
        <Text className="text-lg font-semibold">{t('photo.draftPrompt.title')}</Text>
        <Text className="text-muted-fg">{t('photo.draftPrompt.body')}</Text>
        <Button label={t('photo.draftPrompt.restore')} onPress={onRestore} />
        <Button variant="secondary" label={t('photo.draftPrompt.discard')} onPress={onDiscard} />
      </View>
    </Sheet>
  );
}
