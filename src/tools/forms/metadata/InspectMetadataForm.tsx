import type { Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { setIntakeBatch } from '@/files/session';
import type { IntakeFile } from '@/files/types';
import { Button } from '@/ui/components/Button';
import type { ToolFormProps, ToolInputInfo } from '../../types';
import { InspectPanel } from './InspectPanel';

/** Continues with the same cached file in another metadata tool (the intake registry holds it by id). */
function continueWith(toolId: string, input: ToolInputInfo) {
  let q = '';
  if (input.id && input.uri) {
    const file: IntakeFile = {
      id: input.id,
      uri: input.uri,
      name: input.name,
      extension: input.extension,
      mimeType: input.mime,
      mediaKind: input.mediaKind,
      sizeBytes: input.sizeBytes ?? 0,
      width: input.width,
      height: input.height,
      source: 'picker',
      copiedAt: Date.now(),
    };
    setIntakeBatch({ files: [file], rejected: [] });
    q = `?intake=${encodeURIComponent(file.id)}`;
  }
  // Lazy: keeps expo-router out of every test that only imports the registry.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { router } = require('expo-router') as typeof import('expo-router');
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
              onPress={() => continueWith('strip-metadata', input)}
              testID="inspect-strip"
            />
          ) : null}
          {input?.mediaKind === 'image' ? (
            <Button
              label={t('tools.metadata.edit.open')}
              variant="secondary"
              onPress={() => continueWith('edit-metadata', input)}
              testID="inspect-edit"
            />
          ) : null}
        </View>
      )}
    </InspectPanel>
  );
}
