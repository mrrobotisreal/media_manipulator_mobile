import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Field } from '@/ui/components/Field';
import { ChipRow } from '@/ui/components/ChipRow';
import { CODEC_FORMATS, type ConvertForm } from '../../options/video';
import type { VideoContainer } from '../../options/videoSchema';
import type { ToolFormProps } from '../../types';

const FORMATS: VideoContainer[] = ['mp4', 'webm', 'mov', 'mkv', 'avi'];

export function VideoConvertForm({ value, onChange }: ToolFormProps<ConvertForm>) {
  const { t } = useTranslation();
  const hasCodec = CODEC_FORMATS.includes(value.format);
  return (
    <View className="gap-4" testID="video-convert-form">
      <Field label={t('tools.video.format')}>
        <ChipRow
          options={FORMATS.map((f) => ({ value: f, label: f.toUpperCase() }))}
          value={value.format}
          onChange={(format) => onChange({ ...value, format })}
        />
      </Field>
      {hasCodec ? (
        <Field label={t('interface:videoCompressor.codecLabel')}>
          <ChipRow
            options={[
              { value: 'auto', label: t('tools.video.codecAuto') },
              { value: 'h264', label: 'H.264' },
              { value: 'h265', label: 'H.265' },
            ]}
            value={value.codec}
            onChange={(codec) => onChange({ ...value, codec })}
          />
        </Field>
      ) : null}
      <Field label={t('tools.video.qualityLabel')}>
        <ChipRow
          options={[
            { value: 'low', label: t('tools.video.quality.low') },
            { value: 'medium', label: t('tools.video.quality.medium') },
            { value: 'high', label: t('tools.video.quality.high') },
          ]}
          value={value.quality}
          onChange={(quality) => onChange({ ...value, quality })}
        />
      </Field>
    </View>
  );
}
