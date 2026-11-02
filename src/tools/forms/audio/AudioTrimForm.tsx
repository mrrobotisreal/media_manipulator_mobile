import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { track } from '@/analytics/track';
import { formatNumber } from '@/lib/format';
import { Field } from '../../components/OptionControls';
import { Chips } from '@/ui/components/Chips';
import { Stepper } from '@/ui/components/Stepper';
import { AudioRangeEditor } from '../../native/AudioRangeEditor';
import {
  AUDIO_FORMATS,
  MAX_FADE,
  sameAsOriginalFormat,
  type AudioTrimForm as Form,
  type FormatChoice,
} from '../../options/audio';
import type { ToolFormProps } from '../../types';
import { useSetOption } from '../../useSetOption';
import { formatChoiceOptions } from './formatChoice';

// i18n-keys: tools.audio.format, tools.audio.trim.fadeIn, tools.audio.trim.fadeOut, tools.audio.trim.seconds, tools.audio.sameAsOriginal
export function AudioTrimForm({ value, onChange, ctx }: ToolFormProps<Form>) {
  const { t } = useTranslation();
  const set = useSetOption(value, onChange);
  const file = ctx?.input;
  const ext = file?.extension;
  const onRange = useCallback(
    (startTime: number, endTime: number) => {
      onChange({ ...value, startTime, endTime });
      // Track once per edit, never the times themselves.
      track('options_changed', { option: 'trim' });
    },
    [value, onChange],
  );
  // The default window is 0-30 s; clamp it to the real duration once known.
  const onDuration = useCallback(
    (d: number) => {
      if (value.endTime > d || value.startTime >= d)
        onChange({
          ...value,
          startTime: Math.min(value.startTime, Math.max(0, d - 0.1)),
          endTime: d,
        });
    },
    [value, onChange],
  );
  const sec = (n: number) => t('tools.audio.trim.seconds', { value: formatNumber(n) });
  return (
    <View className="gap-5">
      {file?.uri ? (
        <AudioRangeEditor
          uri={file.uri}
          start={value.startTime}
          end={value.endTime}
          onChange={onRange}
          fallbackDuration={file.durationSec}
          onDuration={onDuration}
        />
      ) : null}
      <Stepper
        label={t('tools.audio.trim.fadeIn')}
        value={value.fadeIn}
        min={0}
        max={MAX_FADE}
        step={0.5}
        format={() => sec(value.fadeIn)}
        onChange={(v) => set('fadeIn', v)}
      />
      <Stepper
        label={t('tools.audio.trim.fadeOut')}
        value={value.fadeOut}
        min={0}
        max={MAX_FADE}
        step={0.5}
        format={() => sec(value.fadeOut)}
        onChange={(v) => set('fadeOut', v)}
      />
      <Field label={t('tools.audio.format')}>
        <Chips
          testIDPrefix="format"
          value={value.format}
          onChange={(v: FormatChoice) => set('format', v)}
          options={formatChoiceOptions(t, ext, AUDIO_FORMATS, sameAsOriginalFormat)}
        />
      </Field>
    </View>
  );
}
