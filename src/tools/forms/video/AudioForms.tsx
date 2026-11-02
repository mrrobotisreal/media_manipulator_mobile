import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Field } from '@/ui/components/Field';
import { Chips } from '@/ui/components/Chips';
import {
  AUDIO_EXTRACT_FORMATS,
  type ExtractAudioForm,
  type RemoveAudioForm,
} from '../../options/video';
import type { ToolFormProps } from '../../types';

// i18n-keys: interface:extractAudio.formats.mp3, interface:extractAudio.formats.wav, interface:extractAudio.formats.m4a, interface:extractAudio.formats.aac, interface:extractAudio.formats.flac, interface:extractAudio.formats.ogg
export function VideoExtractAudioForm({ value, onChange }: ToolFormProps<ExtractAudioForm>) {
  const { t } = useTranslation();
  return (
    <View className="gap-4" testID="video-extract-audio-form">
      <Field
        label={t('interface:extractAudio.formatLabel')}
        hint={t(`interface:extractAudio.formats.${value.format}`)}
      >
        <Chips
          options={AUDIO_EXTRACT_FORMATS.map((f) => ({ value: f, label: f.toUpperCase() }))}
          value={value.format}
          onChange={(format) => onChange({ format })}
        />
      </Field>
    </View>
  );
}

export function VideoRemoveAudioForm({ value, onChange }: ToolFormProps<RemoveAudioForm>) {
  const { t } = useTranslation();
  return (
    <View className="gap-4" testID="video-remove-audio-form">
      <Field label={t('interface:extractVideoOnly.formatLabel')}>
        <Chips
          options={[
            { value: 'mp4', label: t('interface:extractVideoOnly.formats.mp4') },
            { value: 'webm', label: t('interface:extractVideoOnly.formats.webm') },
          ]}
          value={value.format}
          onChange={(format) => onChange({ format })}
        />
      </Field>
    </View>
  );
}
