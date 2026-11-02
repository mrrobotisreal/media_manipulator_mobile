import { router, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { getIntakeFiles } from '@/files/session';
import { Button } from '@/ui/components/Button';
import type { ToolFormProps } from '../../types';
import { InspectPanel } from './InspectPanel';

/** Continues with the same cached file in another metadata tool. */
function continueWith(toolId: string, intakeId: string | undefined) {
  const file = intakeId ? getIntakeFiles([intakeId])[0] : undefined;
  const q = file ? `?intake=${encodeURIComponent(file.id)}` : '';
  router.push(`/(app)/tool/metadata/${toolId}${q}` as Href);
}

/** `inspect-metadata`: auto-inspects on pick (no Run button), offers Strip everything and Edit. */
export function InspectMetadataForm({ ctx }: ToolFormProps) {
  const { t } = useTranslation();
  const input = ctx?.input;
  return (
    <InspectPanel input={input}>
      {() => (
        <View className="flex-row flex-wrap gap-2" testID="inspect-actions">
          {input && input.mediaKind !== 'pdf' ? (
            <Button
              label={t('tools.metadata.strip.stripEverything')}
              onPress={() => continueWith('strip-metadata', input.id)}
              testID="inspect-strip"
            />
          ) : null}
          {input?.mediaKind === 'image' ? (
            <Button
              label={t('tools.metadata.edit.open')}
              variant="secondary"
              onPress={() => continueWith('edit-metadata', input.id)}
              testID="inspect-edit"
            />
          ) : null}
        </View>
      )}
    </InspectPanel>
  );
}
