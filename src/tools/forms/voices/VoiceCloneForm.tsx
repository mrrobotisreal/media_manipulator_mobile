import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';
import { createVoice, realCreateVoiceDeps, useListVoicesQuery } from '@/api/endpoints/voices';
import type { MmError } from '@/api/errors';
import type { SavedVoice } from '@/api/schemas/voices';
import { trackVoiceCreated } from '@/voices/analytics';
import { atVoiceLimit, cloneBlockReason } from '@/voices/cloneFlow';
import { voiceErrorText } from '@/voices/errors';
import { defaultVoiceLanguage } from '@/voices/languageDefault';
import { ConsentGate } from '@/voices/ui/ConsentGate';
import { LanguageField } from '@/voices/ui/LanguageField';
import { RecorderPanel } from '@/voices/ui/RecorderPanel';
import { SpeakPanel } from '@/voices/ui/SpeakPanel';
import { VoiceGate } from '@/voices/ui/VoiceGate';
import { VoiceSummary } from '@/voices/ui/VoiceCard';
import { openMyVoices } from '@/voices/nav';
import { useVoicesCapabilities } from '@/voices/useVoicesCapabilities';
import { useActiveLocale } from '@/i18n/useActiveLocale';
import { formatNumber } from '@/lib/format';
import {
  VOICE_CONSENT_TEXT_VERSION,
  VOICE_NAME_MAX_CHARS,
  VOICE_REFERENCE_MAX_SECONDS,
  VOICE_REFERENCE_MIN_SECONDS,
} from '@/tools/voices/consent';
import { Button } from '@/ui/components/Button';
import { colors } from '@/ui/tokens';
import { Text } from '@/ui/components/Text';
import { TextField } from '@/ui/components/TextField';
import type { ToolFormProps } from '../../types';

type Ready = { kind: 'ready'; voice: SavedVoice };

/**
 * voice-clone (ticket MA34 decisions 3 and 5): record (or pick a 5 to 60 s file), name it, choose the
 * language, tick the consent record, Create. The create call is synchronous and slow (the preview render,
 * up to ~60 s, one `ai_ops`): Create is disabled the moment it is pressed so a second tap cannot spend a
 * second unit. The consent box resets whenever the recording changes.
 */
export function VoiceCloneForm({ ctx, onFiles }: ToolFormProps<Record<string, never>>) {
  const { t } = useTranslation();
  const locale = useActiveLocale();
  const { caps } = useVoicesCapabilities();
  const list = useListVoicesQuery();
  const file = ctx?.files?.[0] ?? undefined;
  const fileId = file?.id;

  const offered = caps?.languages ?? [];
  const [name, setName] = useState('');
  const [language, setLanguage] = useState<string | null>(null);
  // The consent record belongs to one recording: it is stored with that file's id, so a new (or removed)
  // file reads as un-ticked without an effect.
  const [consentFor, setConsentFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MmError | null>(null);
  const [created, setCreated] = useState<Ready | null>(null);
  const inFlight = useRef(false);

  const consent = !!fileId && consentFor === fileId;
  const setConsent = (next: boolean) => setConsentFor(next && fileId ? fileId : null);

  const lang = language ?? defaultVoiceLanguage(locale, offered);
  const limit = list.data?.limit ?? caps?.limits.voicesSaved ?? 0;
  const used = list.data?.used ?? 0;
  const atLimit = atVoiceLimit(used, limit);
  const block = cloneBlockReason({
    hasFile: !!file,
    durationSec: file?.durationSec,
    name,
    consent,
    atLimit,
    busy,
  });

  const create = async () => {
    if (inFlight.current || block !== null || !file) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const r = await createVoice(
      {
        file: { uri: file.uri, mimeType: file.mimeType },
        name: name.trim(),
        languageHint: lang,
        consent: true,
        consentTextVersion: VOICE_CONSENT_TEXT_VERSION,
      },
      realCreateVoiceDeps(),
    );
    inFlight.current = false;
    setBusy(false);
    if (r.ok) {
      trackVoiceCreated('cloned', r.voice.languageHint, 'voice-cloning');
      setCreated({ kind: 'ready', voice: r.voice });
      setConsent(false);
    } else {
      setError(r.error);
    }
  };

  const reset = () => {
    setCreated(null);
    setName('');
    setError(null);
    onFiles?.([]);
  };

  return (
    <VoiceGate capability="voiceClone">
      {created ? (
        <View className="gap-4" testID="clone-created">
          <Text className="text-muted-fg">{t('interface:voiceTools.clone.created')}</Text>
          <VoiceSummary voice={created.voice} />
          {caps ? (
            <SpeakPanel
              caps={caps}
              voice={{ id: created.voice.id, name: created.voice.name }}
              defaultLanguage={created.voice.languageHint}
              source="tool_page"
              toolId="voice-clone"
            />
          ) : null}
          <Button variant="secondary" label={t('tools.voices.clone.another')} onPress={reset} />
          <Button
            variant="ghost"
            label={t('interface:voiceTools.myVoices.title')}
            onPress={openMyVoices}
          />
        </View>
      ) : (
        <View className="gap-4">
          <RecorderPanel
            minSeconds={VOICE_REFERENCE_MIN_SECONDS}
            maxSeconds={VOICE_REFERENCE_MAX_SECONDS}
            hint={t('interface:voiceTools.recorder.referenceHint')}
            onTake={(f) => onFiles?.([f])}
            onDiscard={() => onFiles?.([])}
          />
          {file && file.durationSec !== undefined && block === 'too_short' ? (
            <Text
              accessibilityLiveRegion="polite"
              testID="clone-too-short"
              className="text-sm text-danger"
            >
              {t('interface:voiceTools.recorder.tooShort', {
                seconds: Math.round(file.durationSec),
              })}
            </Text>
          ) : null}
          {file && file.durationSec !== undefined && block === 'too_long' ? (
            <Text
              accessibilityLiveRegion="polite"
              testID="clone-too-long"
              className="text-sm text-danger"
            >
              {t('interface:voiceTools.recorder.tooLong', {
                seconds: Math.round(file.durationSec),
              })}
            </Text>
          ) : null}
          <TextField
            testID="clone-name"
            label={t('interface:voiceTools.clone.nameLabel')}
            placeholder={t('interface:voiceTools.clone.namePlaceholder')}
            value={name}
            onChangeText={setName}
            maxLength={VOICE_NAME_MAX_CHARS}
            editable={!busy}
          />
          {offered.length > 0 ? (
            <LanguageField
              testID="clone-language"
              label={t('interface:voiceTools.clone.languageLabel')}
              value={lang}
              options={offered}
              onChange={setLanguage}
            />
          ) : null}
          <ConsentGate checked={consent} onChange={setConsent} disabled={busy || !file} />
          {caps ? (
            <Text className="text-sm text-subtle" testID="clone-usage">
              {limit === -1
                ? t('interface:voiceTools.clone.usageUnlimited', { used: formatNumber(used) })
                : t('interface:voiceTools.clone.usage', {
                    used: formatNumber(used),
                    limit: formatNumber(limit),
                  })}
            </Text>
          ) : null}
          {atLimit ? (
            <Text
              accessibilityLiveRegion="polite"
              testID="clone-at-limit"
              className="text-sm text-muted-fg"
            >
              {t('tools.voices.limitReached', {
                used: formatNumber(used),
                limit: formatNumber(limit),
              })}
            </Text>
          ) : null}
          {error ? (
            <Text
              accessibilityLiveRegion="polite"
              testID="clone-error"
              className="text-sm text-danger"
            >
              {voiceErrorText(t, error)}
            </Text>
          ) : null}
          {busy ? (
            <View className="flex-row items-center gap-2" testID="clone-creating">
              <ActivityIndicator color={colors.data} />
              <Text className="flex-1 text-muted-fg">
                {t('interface:voiceTools.clone.creating')}
              </Text>
            </View>
          ) : null}
          <Button
            testID="clone-create"
            label={t('interface:voiceTools.clone.create')}
            disabled={block !== null}
            loading={busy}
            onPress={() => void create()}
          />
          <Text className="text-xs text-subtle">{t('interface:voiceTools.honesty')}</Text>
        </View>
      )}
    </VoiceGate>
  );
}
