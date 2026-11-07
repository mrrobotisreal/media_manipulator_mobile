import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { SavedVoice } from '@/api/schemas/voices';
import { useActiveLocale } from '@/i18n/useActiveLocale';
import { languageName } from '@/tools/forms/ai/languages';
import { formatDateTime } from '@/lib/format';
import { Num, Text } from '@/ui/components/Text';
import { AudioClip } from './AudioClip';

/** One saved voice: name, kind, language, dates (created, and the consent date for a cloned voice), preview. */
export function VoiceSummary({ voice }: { voice: SavedVoice }) {
  const { t } = useTranslation();
  const locale = useActiveLocale();
  const kind = (['cloned', 'designed', 'preset'] as const).find((k) => k === voice.kind);
  return (
    <View className="gap-1" testID={`voice-${voice.id}`}>
      <Text className="text-base font-semibold" numberOfLines={1}>
        {voice.name}
      </Text>
      <Text className="text-sm text-muted-fg">
        {kind ? t(`interface:voiceTools.myVoices.kinds.${kind}`) : voice.kind}
        {' · '}
        {languageName(voice.languageHint, locale)}
      </Text>
      {voice.createdAt ? (
        <Num className="text-xs text-subtle">
          {t('tools.voices.myVoices.created', { date: formatDateTime(voice.createdAt, 'date') })}
        </Num>
      ) : null}
      {voice.consentAt ? (
        <Num className="text-xs text-subtle" testID={`voice-consent-${voice.id}`}>
          {t('tools.voices.myVoices.consent', { date: formatDateTime(voice.consentAt, 'date') })}
        </Num>
      ) : null}
      {voice.previewUrl ? (
        <AudioClip
          uri={voice.previewUrl}
          label={t('interface:voiceTools.myVoices.preview', { name: voice.name })}
        />
      ) : null}
    </View>
  );
}
