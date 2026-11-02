import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Field } from '@/ui/components/Field';
import { ChipRow } from '@/ui/components/ChipRow';
import { ToggleRow } from '@/ui/components/ToggleRow';
import type { CompressForm } from '../../options/video';
import type { ToolFormProps } from '../../types';

// i18n-keys: interface:videoCompressor.levelHints.smallest, interface:videoCompressor.levelHints.balanced, interface:videoCompressor.levelHints.high_quality
export function VideoCompressForm({ value, onChange }: ToolFormProps<CompressForm>) {
  const { t } = useTranslation();
  const set = (patch: Partial<CompressForm>) => onChange({ ...value, ...patch });
  return (
    <View className="gap-4" testID="video-compress-form">
      <Field
        label={t('interface:videoCompressor.levelLabel')}
        hint={t(`interface:videoCompressor.levelHints.${value.level}`)}
      >
        <ChipRow
          options={[
            { value: 'smallest', label: t('interface:videoCompressor.levels.smallest') },
            { value: 'balanced', label: t('interface:videoCompressor.levels.balanced') },
            { value: 'high_quality', label: t('interface:videoCompressor.levels.high_quality') },
          ]}
          value={value.level}
          onChange={(level) => set({ level })}
        />
      </Field>
      <Field label={t('tools.video.format')}>
        <ChipRow
          options={[
            { value: 'mp4', label: 'MP4' },
            { value: 'webm', label: 'WebM' },
          ]}
          value={value.format}
          onChange={(format) => set({ format })}
        />
      </Field>
      {value.format !== 'webm' ? (
        <Field label={t('interface:videoCompressor.codecLabel')}>
          <ChipRow
            options={[
              { value: 'h264', label: t('interface:videoCompressor.codecs.h264') },
              { value: 'h265', label: t('interface:videoCompressor.codecs.h265') },
            ]}
            value={value.codec}
            onChange={(codec) => set({ codec })}
          />
        </Field>
      ) : null}
      <Field label={t('interface:videoCompressor.resolutionLabel')}>
        <ChipRow
          options={[
            { value: 'keep', label: t('interface:videoCompressor.resolutions.keep') },
            { value: '1080', label: t('interface:videoCompressor.resolutions.1080') },
            { value: '720', label: t('interface:videoCompressor.resolutions.720') },
            { value: '480', label: t('interface:videoCompressor.resolutions.480') },
          ]}
          value={value.resolution}
          onChange={(resolution) => set({ resolution })}
        />
      </Field>
      <ToggleRow
        label={t('interface:videoCompressor.stripAudio')}
        value={value.stripAudio}
        onChange={(stripAudio) => set({ stripAudio })}
      />
    </View>
  );
}
