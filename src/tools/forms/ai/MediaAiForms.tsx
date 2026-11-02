import { useState } from 'react';
import { Switch, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { getActiveLocale } from '@/i18n';
import { formatBytes, formatDuration } from '@/lib/format';
import { Chips } from '@/ui/components/Chips';
import { Segmented } from '@/ui/components/Segmented';
import { Num, Text } from '@/ui/components/Text';
import { TextField } from '@/ui/components/TextField';
import {
  frameInterpolationBlockReason,
  INTERP_SERVER_LIMITS,
  isLanguageCode,
  normalizeLanguage,
  sameAudioFormat,
  TRANSCRIBE_FORMATS,
  type FrameInterpolationForm as InterpState,
  type InterpFps,
  type InterpMaxHeight,
  type StemForm as StemState,
  type TranscribeForm as TranscribeState,
} from '../../options/ai';
import {
  effectiveStemFormat,
  estimateStemBytes,
  wavNeedsHint,
  type StemFormatChoice,
} from '../../options/stemFormat';
import type { ToolFormProps } from '../../types';
import { FieldLabel } from '../image/shared';
import { languageName, TRANSCRIBE_LANGUAGES } from './languages';

/** clean-voice / remove-noise: no options; the output format is the input's (MA19 decision 4). */
export function VoiceForm({ ctx }: ToolFormProps<Record<string, never>>) {
  const { t } = useTranslation();
  const format = sameAudioFormat(ctx?.input?.extension);
  return (
    <View className="gap-1">
      <FieldLabel>{t('interface:audioForm.stemFormat.label')}</FieldLabel>
      <Text>{t('tools.ai.stem.sameAs', { format: format.toUpperCase() })}</Text>
    </View>
  );
}

const STEM_CHOICES: StemFormatChoice[] = ['auto', 'mp3', 'flac', 'wav'];

/** isolate-vocals / remove-vocals output format. */
export function StemForm({ value, onChange, ctx }: ToolFormProps<StemState>) {
  const { t } = useTranslation();
  const input = ctx?.input;
  const resolved = effectiveStemFormat('auto', input?.name, input?.mime);
  const effective = effectiveStemFormat(value.output, input?.name, input?.mime);
  const bytes = estimateStemBytes(effective, input?.durationSec);
  return (
    <View className="gap-3">
      <FieldLabel>{t('interface:audioForm.stemFormat.label')}</FieldLabel>
      <Chips
        options={STEM_CHOICES.map((c) => ({
          value: c,
          label:
            c === 'auto'
              ? t('tools.ai.stem.sameAs', { format: resolved.toUpperCase() })
              : t(`interface:audioForm.stemFormat.options.${c}`),
        }))}
        value={value.output}
        onChange={(output) => onChange({ ...value, output })}
      />
      <Text className="text-sm text-subtle">
        {bytes === null
          ? t('interface:audioForm.stemFormat.helpNoEstimate')
          : t('interface:audioForm.stemFormat.help')}
      </Text>
      {value.output === 'wav' && wavNeedsHint(bytes) ? (
        <Text className="text-sm text-muted-fg">
          {t('interface:audioForm.stemFormat.wavHint', { size: formatBytes(bytes ?? 0) })}
        </Text>
      ) : null}
    </View>
  );
}

const FPS: InterpFps[] = [48, 60, 120];
const HEIGHTS: InterpMaxHeight[] = [360, 480, 720];
const QUALITIES = ['low', 'medium', 'high'] as const;

export function FrameInterpolationForm({ value, onChange, ctx }: ToolFormProps<InterpState>) {
  const { t } = useTranslation();
  const blocked = frameInterpolationBlockReason(value, ctx) === 'too_long';
  const dur = ctx?.input?.durationSec;
  return (
    <View className="gap-3">
      <Text className="text-sm text-muted-fg">{t('interface:aiVideoTools.intro')}</Text>
      <FieldLabel>{t('interface:aiVideoTools.frameInterpolation.targetFpsLabel')}</FieldLabel>
      <Chips
        options={FPS.map((f) => ({ value: f, label: `${f} fps` }))}
        value={value.targetFps}
        onChange={(targetFps) => onChange({ ...value, targetFps: targetFps as InterpFps })}
      />
      <FieldLabel>{t('interface:aiVideoTools.frameInterpolation.maxHeightLabel')}</FieldLabel>
      <Chips
        options={HEIGHTS.map((h) => ({ value: h, label: `${h}p` }))}
        value={value.maxHeight}
        onChange={(maxHeight) => onChange({ ...value, maxHeight: maxHeight as InterpMaxHeight })}
      />
      <FieldLabel>{t('interface:aiVideoTools.frameInterpolation.qualityLabel')}</FieldLabel>
      <Segmented
        options={QUALITIES.map((q) => ({
          value: q,
          label: t(`interface:aiVideoTools.frameInterpolation.qualityOptions.${q}`).split(' — ')[0] ?? q,
        }))}
        value={value.quality}
        onChange={(quality) => onChange({ ...value, quality })}
      />
      <View className="flex-row items-center justify-between gap-3">
        <Text className="flex-1">{t('interface:aiVideoTools.frameInterpolation.preserveAudio')}</Text>
        <Switch
          value={value.preserveAudio}
          onValueChange={(preserveAudio) => onChange({ ...value, preserveAudio })}
          accessibilityLabel={t('interface:aiVideoTools.frameInterpolation.preserveAudio')}
        />
      </View>
      <Num className="text-sm text-subtle">
        {t('tools.ai.interp.limits', {
          seconds: INTERP_SERVER_LIMITS.maxSeconds,
          height: INTERP_SERVER_LIMITS.maxHeight,
        })}
      </Num>
      <Text className="text-sm text-subtle">{t('interface:aiVideoTools.notes.mp4')}</Text>
      {blocked && dur !== undefined ? (
        <Text className="text-sm text-danger" accessibilityLiveRegion="polite" testID="interp-too-long">
          {t('tools.ai.interp.tooLong', {
            duration: formatDuration(dur),
            seconds: INTERP_SERVER_LIMITS.maxSeconds,
          })}
        </Text>
      ) : null}
    </View>
  );
}

export function TranscribeForm({ value, onChange }: ToolFormProps<TranscribeState>) {
  const { t } = useTranslation();
  const locale = getActiveLocale();
  const known = value.language === '' || TRANSCRIBE_LANGUAGES.includes(value.language);
  const [otherOpen, setOtherOpen] = useState(!known);
  const other = otherOpen || !known;
  const bad = other && normalizeLanguage(value.language) !== '' && !isLanguageCode(value.language);
  return (
    <View className="gap-3">
      <FieldLabel>{t('interface:transcribeForm.outputFormatTitle')}</FieldLabel>
      <Chips
        options={TRANSCRIBE_FORMATS.map((f) => ({
          value: f,
          label: t(`interface:transcribeForm.format.${f}.label`),
        }))}
        value={value.format}
        onChange={(format) => onChange({ ...value, format, slugHint: undefined })}
      />
      <Text className="text-sm text-subtle">
        {t(`interface:transcribeForm.format.${value.format}.description`)}
      </Text>
      <FieldLabel>{t('tools.transcribe.language')}</FieldLabel>
      <Chips
        options={[
          { value: '', label: t('tools.transcribe.auto') },
          ...TRANSCRIBE_LANGUAGES.map((c) => ({ value: c, label: languageName(c, locale) })),
          { value: '__other', label: t('tools.transcribe.other') },
        ]}
        value={other ? '__other' : value.language}
        onChange={(v) => {
          if (v === '__other') {
            setOtherOpen(true);
            onChange({ ...value, language: known ? '' : value.language });
          } else {
            setOtherOpen(false);
            onChange({ ...value, language: v });
          }
        }}
      />
      {other ? (
        <TextField
          label={t('tools.transcribe.other')}
          helper={t('tools.transcribe.otherHint')}
          error={bad ? t('tools.transcribe.otherHint') : null}
          value={value.language}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={3}
          onChangeText={(language) => onChange({ ...value, language })}
        />
      ) : null}
    </View>
  );
}
