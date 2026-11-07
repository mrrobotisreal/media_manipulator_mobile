import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Text } from '@/ui/components/Text';
import { changeBlockReason, type ChangeForm } from '../../options/voices';
import type { ToolFormProps } from '../../types';
import { LanguageField } from '@/voices/ui/LanguageField';
import { RecorderPanel } from '@/voices/ui/RecorderPanel';
import { VoiceGate } from '@/voices/ui/VoiceGate';
import { languagesFor, VoicePicker } from '@/voices/ui/VoicePicker';
import { useVoicesCapabilities } from '@/voices/useVoicesCapabilities';

const FALLBACK_MAX_SECONDS = 300;

/** voice-change (ticket MA34 decision 8): AI-convert a recording to a saved voice or a preset voice. */
export function VoiceChangeForm({ value, onChange, ctx, onFiles }: ToolFormProps<ChangeForm>) {
  const { t } = useTranslation();
  const { caps } = useVoicesCapabilities();
  const cap = caps?.limits.voicesConvertMaxSeconds ?? 0;
  // The screen's builder and block reason read the plan's cap from the form value.
  useEffect(() => {
    if (cap !== (value.convertMaxSeconds ?? 0)) onChange({ ...value, convertMaxSeconds: cap });
  }, [cap, value, onChange]);

  const presets = caps?.presets ?? [];
  const all = caps?.languages ?? [];
  const languages = languagesFor(value, presets, all);
  const language =
    value.language && languages.includes(value.language)
      ? value.language
      : languages.includes('en')
        ? 'en'
        : languages[0];
  const block = changeBlockReason(value, ctx);

  return (
    <VoiceGate capability="voiceChange">
      <RecorderPanel
        maxSeconds={cap > 0 ? cap : FALLBACK_MAX_SECONDS}
        hint={t('interface:voiceTools.recorder.inputHint')}
        onTake={(f) => onFiles?.([f])}
        onDiscard={() => onFiles?.([])}
      />
      <VoicePicker
        value={value}
        presets={presets}
        onChange={(target) =>
          onChange({ ...value, voiceId: target.voiceId, preset: target.preset })
        }
      />
      {value.preset && language ? (
        <LanguageField
          label={t('interface:voiceTools.speak.languageLabel')}
          value={language}
          options={languages}
          onChange={(code) => onChange({ ...value, language: code })}
        />
      ) : null}
      <Text className="text-sm text-subtle">{t('interface:voiceTools.changer.convertHint')}</Text>
      {block === 'too_long' ? (
        <View accessibilityLiveRegion="polite">
          <Text testID="change-too-long" className="text-sm text-danger">
            {t('interface:voiceTools.errors.voice_input_too_long', { limit: cap })}
          </Text>
        </View>
      ) : null}
    </VoiceGate>
  );
}
