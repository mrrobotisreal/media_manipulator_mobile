import { useTranslation } from 'react-i18next';
import { Text } from '@/ui/components/Text';
import type { ToolFormProps } from '../../types';
import { InspectPanel } from './InspectPanel';
import { audioStripFormat, imageStripFormat, videoStripFormat } from '../../options/metadata';

/** `strip-metadata`: shows what the file carries today (auto-inspect), then Strip everything runs. */
export function StripMetadataForm({ ctx }: ToolFormProps) {
  const { t } = useTranslation();
  const input = ctx?.input;
  const out = !input
    ? undefined
    : input.mediaKind === 'video'
      ? videoStripFormat(input.extension)
      : input.mediaKind === 'audio'
        ? audioStripFormat(input.extension)
        : imageStripFormat(input.extension);
  return (
    <InspectPanel input={input}>
      {() => (
        <>
          <Text className="text-muted-fg">{t('tools.metadata.strip.intro')}</Text>
          {out ? (
            <Text className="text-sm text-subtle" testID="strip-format-note">
              {t('tools.metadata.formatNote', { format: out.toUpperCase() })}
            </Text>
          ) : null}
          {input && input.mediaKind !== 'image' ? (
            <Text className="text-sm text-subtle">{t('tools.metadata.strip.reencodeNote')}</Text>
          ) : null}
        </>
      )}
    </InspectPanel>
  );
}
