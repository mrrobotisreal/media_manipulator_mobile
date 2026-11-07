import type { Href } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { VoicesCapabilities } from '@/api/schemas/voices';
import type { VoiceSourceProp } from '@/analytics/events';
import { formatNumber } from '@/lib/format';
import {
  VOICE_EXAGGERATION_DEFAULT,
  VOICE_EXAGGERATION_MAX,
  VOICE_EXAGGERATION_MIN,
  VOICE_EXAGGERATION_STEP,
} from '@/tools/voices/consent';
import { Button } from '@/ui/components/Button';
import { Slider } from '@/ui/components/Slider';
import { Num, Text } from '@/ui/components/Text';
import { TextField } from '@/ui/components/TextField';
import { startSpeakJob } from '../startSpeak';
import { LanguageField } from './LanguageField';

/**
 * Speak (ticket MA34 decision 7): text (live counter against the plan's `textMaxChars`), language, and the
 * Exaggeration slider (saved voices only), then Generate. `voice` is a saved voice (its language hint is the
 * default language) or a preset (limited to the preset's languages).
 */
export function SpeakPanel({
  caps,
  voice,
  preset,
  languages,
  defaultLanguage,
  source,
  toolId,
}: {
  caps: Pick<VoicesCapabilities, 'limits' | 'languages'>;
  voice?: { id: string; name: string };
  preset?: { id: string; name: string };
  /** The languages offered; defaults to every capabilities language. */
  languages?: readonly string[];
  defaultLanguage?: string;
  source: VoiceSourceProp;
  toolId?: 'voice-clone' | 'voice-design';
}) {
  const { t } = useTranslation();
  const offered = languages && languages.length > 0 ? languages : caps.languages;
  const first =
    defaultLanguage && offered.includes(defaultLanguage)
      ? defaultLanguage
      : offered.includes('en')
        ? 'en'
        : (offered[0] ?? 'en');
  const [text, setText] = useState('');
  const [language, setLanguage] = useState(first);
  const [exaggeration, setExaggeration] = useState(VOICE_EXAGGERATION_DEFAULT);
  const [busy, setBusy] = useState(false);
  const max = caps.limits.textMaxChars;
  const length = [...text].length;
  const over = max > 0 && length > max;
  const notAllowed = max <= 0;
  const trimmed = text.trim();

  const generate = () => {
    if (busy || !trimmed || over || notAllowed) return;
    setBusy(true);
    const id = startSpeakJob(
      {
        ...(voice ? { voiceId: voice.id } : { preset: preset?.id }),
        text: trimmed,
        language,
        ...(voice ? { exaggeration } : {}),
        source,
      },
      toolId,
    );
    setBusy(false);
    if (id) {
      // Lazy: keeps expo-router out of pure imports of the registry.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { router } = require('expo-router') as typeof import('expo-router');
      router.push(`/(app)/job/${id}` as Href);
    }
  };

  return (
    <View className="gap-3 rounded-lg border border-edge bg-surface-1 p-3" testID="speak-panel">
      <Text className="font-semibold">{t('interface:voiceTools.speak.title')}</Text>
      {notAllowed ? (
        <Text className="text-sm text-danger">{t('interface:voiceTools.speak.notAllowed')}</Text>
      ) : null}
      <TextField
        testID="speak-text"
        label={t('interface:voiceTools.speak.textLabel')}
        placeholder={t('interface:voiceTools.speak.placeholder')}
        value={text}
        onChangeText={setText}
        multiline
        style={{ minHeight: 96, textAlignVertical: 'top', textAlign: 'auto' }}
        error={over ? t('interface:voiceTools.speak.overLimit', { max: formatNumber(max) }) : null}
      />
      <Num className="text-sm text-subtle" testID="speak-counter">
        {t('interface:voiceTools.speak.counter', {
          used: formatNumber(length),
          max: formatNumber(max),
        })}
      </Num>
      <LanguageField
        testID="speak-language"
        label={t('interface:voiceTools.speak.languageLabel')}
        value={language}
        options={offered}
        onChange={setLanguage}
      />
      {voice ? (
        <View className="gap-1">
          <Slider
            testID="speak-exaggeration"
            label={t('interface:voiceTools.speak.exaggerationLabel')}
            value={exaggeration}
            min={VOICE_EXAGGERATION_MIN}
            max={VOICE_EXAGGERATION_MAX}
            step={VOICE_EXAGGERATION_STEP}
            format={(v) =>
              formatNumber(v, undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            }
            onChange={(v) => setExaggeration(Math.round(v * 100) / 100)}
          />
          <Text className="text-xs text-subtle">
            {t('interface:voiceTools.speak.exaggerationHint')}
          </Text>
        </View>
      ) : null}
      <Button
        testID="speak-generate"
        label={t('interface:voiceTools.speak.generate')}
        disabled={!trimmed || over || notAllowed}
        loading={busy}
        onPress={generate}
      />
      <Text className="text-xs text-subtle">{t('interface:voiceTools.honesty')}</Text>
    </View>
  );
}
