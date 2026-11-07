import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';
import {
  useDesignVoiceMutation,
  useListVoicesQuery,
  usePreviewDesignMutation,
} from '@/api/endpoints/voices';
import { isMmError, type MmError } from '@/api/errors';
import type { DesignPreview, SavedVoice } from '@/api/schemas/voices';
import { useActiveLocale } from '@/i18n/useActiveLocale';
import { VOICE_DESCRIPTION_MAX_CHARS, VOICE_NAME_MAX_CHARS } from '@/tools/voices/consent';
import { Button } from '@/ui/components/Button';
import { Chips } from '@/ui/components/Chips';
import { colors } from '@/ui/tokens';
import { Num, Text } from '@/ui/components/Text';
import { TextField } from '@/ui/components/TextField';
import { formatNumber } from '@/lib/format';
import { trackVoiceCreated } from '@/voices/analytics';
import {
  appendTrait,
  CHIP_GROUPS,
  descriptionOk,
  DESIGN_CHIPS,
  previewsLeft,
} from '@/voices/designFlow';
import { clearPreviews, writePreviewFile } from '@/voices/designPreview';
import { voiceErrorText } from '@/voices/errors';
import { defaultVoiceLanguage } from '@/voices/languageDefault';
import { atVoiceLimit } from '@/voices/cloneFlow';
import { AudioClip } from '@/voices/ui/AudioClip';
import { LanguageField } from '@/voices/ui/LanguageField';
import { SpeakPanel } from '@/voices/ui/SpeakPanel';
import { VoiceSummary } from '@/voices/ui/VoiceCard';
import { VoiceGate } from '@/voices/ui/VoiceGate';
import { openMyVoices } from '@/voices/nav';
import { useVoicesCapabilities } from '@/voices/useVoicesCapabilities';
import type { ToolFormProps } from '../../types';

/**
 * voice-design (ticket MA34 decision 6): describe a voice, Preview (uncounted, 3 per description per hour),
 * "Try another" (no seed), then Save (one `ai_ops`) with the seed of the preview you heard, so the kept voice
 * is exactly the one heard. Chips append English traits (Qwen3-TTS reads descriptions best in English).
 */
export function VoiceDesignForm(_props: ToolFormProps<Record<string, never>>) {
  const { t } = useTranslation();
  const locale = useActiveLocale();
  const { caps } = useVoicesCapabilities();
  const list = useListVoicesQuery();
  const [previewDesign, previewState] = usePreviewDesignMutation();
  const [designVoice, saveState] = useDesignVoiceMutation();

  const offered = caps?.designLanguages ?? [];
  const [description, setDescription] = useState('');
  const [language, setLanguage] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [preview, setPreview] = useState<{ seed: number; uri: string; forKey: string } | null>(
    null,
  );
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<MmError | null>(null);
  const [saved, setSaved] = useState<SavedVoice | null>(null);
  const saving = useRef(false);

  useEffect(() => () => clearPreviews(), []);

  const lang = language ?? defaultVoiceLanguage(locale, offered);
  const key = `${description.trim().toLowerCase()}|${lang}`;
  const left = previewsLeft(counts[key] ?? 0);
  const limit = list.data?.limit ?? caps?.limits.voicesSaved ?? 0;
  const used = list.data?.used ?? 0;
  const atLimit = atVoiceLimit(used, limit);
  const canPreview = descriptionOk(description) && !previewState.isLoading && !saveState.isLoading;
  const fresh = preview && preview.forKey === key ? preview : null;

  const runPreview = async (keepSeed: boolean) => {
    if (!canPreview) return;
    setError(null);
    const r = await previewDesign({
      description: description.trim(),
      language: lang,
      ...(keepSeed && fresh ? { seed: fresh.seed } : {}),
    });
    if ('error' in r && r.error) {
      setError(isMmError(r.error) ? r.error : null);
      return;
    }
    const data = (r as { data: DesignPreview }).data;
    try {
      const uri = writePreviewFile(data.audioBase64, data.seed);
      setPreview({ seed: data.seed, uri, forKey: key });
      setCounts((c) => ({ ...c, [key]: (c[key] ?? 0) + 1 }));
    } catch {
      setError({ status: 'FETCH_ERROR', code: 'unknown', details: {} });
    }
  };

  const save = async () => {
    if (saving.current || !fresh || !name.trim() || atLimit) return;
    saving.current = true;
    setError(null);
    // The seed of the preview you heard: the saved voice is exactly that one.
    const r = await designVoice({
      name: name.trim(),
      description: description.trim(),
      language: lang,
      seed: fresh.seed,
    });
    saving.current = false;
    if ('error' in r && r.error) {
      setError(isMmError(r.error) ? r.error : null);
      return;
    }
    const voice = (r as { data: SavedVoice }).data;
    trackVoiceCreated('designed', voice.languageHint, 'voice-designer');
    setSaved(voice);
  };

  const errorText = error ? voiceErrorText(t, error) : null;

  if (saved) {
    return (
      <VoiceGate capability="voiceDesign">
        <View className="gap-4" testID="design-saved">
          <Text className="text-muted-fg">{t('interface:voiceTools.designer.kept')}</Text>
          <VoiceSummary voice={saved} />
          {caps ? (
            <SpeakPanel
              caps={caps}
              voice={{ id: saved.id, name: saved.name }}
              defaultLanguage={saved.languageHint}
              source="tool_page"
              toolId="voice-design"
            />
          ) : null}
          <Button
            variant="ghost"
            label={t('interface:voiceTools.myVoices.title')}
            onPress={openMyVoices}
          />
        </View>
      </VoiceGate>
    );
  }

  return (
    <VoiceGate capability="voiceDesign">
      <View className="gap-4">
        <TextField
          testID="design-description"
          label={t('interface:voiceTools.designer.descriptionLabel')}
          placeholder={t('interface:voiceTools.designer.placeholder')}
          helper={t('interface:voiceTools.designer.hint')}
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={VOICE_DESCRIPTION_MAX_CHARS}
          style={{ minHeight: 96, textAlignVertical: 'top', textAlign: 'auto' }}
        />
        {CHIP_GROUPS.map((group) => (
          <View key={group} className="gap-1">
            <Text className="text-xs text-subtle">
              {t(`interface:voiceTools.designer.chipGroups.${group}`)}
            </Text>
            <Chips
              testIDPrefix={`chip-${group}`}
              value={null}
              onChange={(chip) =>
                setDescription((d) =>
                  appendTrait(d, (DESIGN_CHIPS[group] as Record<string, string>)[chip]!),
                )
              }
              options={Object.keys(DESIGN_CHIPS[group]).map((chip) => ({
                value: chip,
                label: t(`interface:voiceTools.designer.chips.${chip}`),
              }))}
            />
          </View>
        ))}
        {offered.length > 0 ? (
          <LanguageField
            testID="design-language"
            label={t('interface:voiceTools.designer.languageLabel')}
            value={lang}
            options={offered}
            onChange={setLanguage}
            hint={t('interface:voiceTools.designer.languageNote')}
          />
        ) : null}

        <Button
          testID="design-preview"
          variant="secondary"
          label={
            fresh ? t('tools.voices.design.tryAnother') : t('interface:voiceTools.designer.preview')
          }
          disabled={!canPreview || left === 0}
          loading={previewState.isLoading}
          onPress={() => void runPreview(false)}
        />
        {previewState.isLoading ? (
          <View className="flex-row items-center gap-2">
            <ActivityIndicator color={colors.data} />
            <Text className="flex-1 text-muted-fg">
              {t('interface:voiceTools.designer.previewing')}
            </Text>
          </View>
        ) : null}
        <Num className="text-xs text-subtle" testID="design-previews-left">
          {t('interface:voiceTools.designer.previewsLeft', {
            left: formatNumber(left),
            max: formatNumber(3),
          })}
        </Num>
        {left === 0 && descriptionOk(description) ? (
          <Text accessibilityLiveRegion="polite" className="text-sm text-muted-fg">
            {t('interface:voiceTools.designer.previewsUsed')}
          </Text>
        ) : null}

        {fresh ? (
          <View
            className="gap-3 rounded-lg border border-edge bg-surface-1 p-3"
            testID="design-heard"
          >
            <AudioClip uri={fresh.uri} label={t('interface:voiceTools.designer.previewLabel')} />
            <Text className="font-semibold">{t('interface:voiceTools.designer.keepTitle')}</Text>
            <TextField
              testID="design-name"
              label={t('interface:voiceTools.designer.nameLabel')}
              placeholder={t('interface:voiceTools.clone.namePlaceholder')}
              value={name}
              onChangeText={setName}
              maxLength={VOICE_NAME_MAX_CHARS}
              editable={!saveState.isLoading}
            />
            {atLimit ? (
              <Text
                accessibilityLiveRegion="polite"
                testID="design-at-limit"
                className="text-sm text-muted-fg"
              >
                {t('tools.voices.limitReached', {
                  used: formatNumber(used),
                  limit: formatNumber(limit),
                })}
              </Text>
            ) : null}
            <Button
              testID="design-save"
              label={t('interface:voiceTools.designer.keep')}
              disabled={!name.trim() || atLimit || saveState.isLoading}
              loading={saveState.isLoading}
              onPress={() => void save()}
            />
            {saveState.isLoading ? (
              <View className="flex-row items-center gap-2">
                <ActivityIndicator color={colors.data} />
                <Text className="flex-1 text-muted-fg">
                  {t('interface:voiceTools.designer.keeping')}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
        {errorText ? (
          <Text
            accessibilityLiveRegion="polite"
            testID="design-error"
            className="text-sm text-danger"
          >
            {errorText}
          </Text>
        ) : null}
        <Text className="text-xs text-subtle">{t('interface:voiceTools.honesty')}</Text>
      </View>
    </VoiceGate>
  );
}
