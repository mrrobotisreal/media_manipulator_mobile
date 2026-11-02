import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Field } from '@/ui/components/Field';
import { ChipRow } from '@/ui/components/ChipRow';
import { TrimRangeScrubber } from '../../native/TrimRangeScrubber';
import {
  GIF_COLORS,
  GIF_DEFAULT_SECONDS,
  GIF_FPS,
  GIF_WIDTHS,
  type GifForm,
} from '../../options/video';
import type { ToolFormProps } from '../../types';

export function VideoToGifForm({ value, onChange, file }: ToolFormProps<GifForm>) {
  const { t } = useTranslation();
  return (
    <View className="gap-4" testID="video-to-gif-form">
      {file?.uri ? (
        <Field hint={t('tools.video.gif.rangeHint')}>
          <TrimRangeScrubber
            uri={file.uri}
            durationSec={file.durationSec}
            start={value.start}
            end={value.end}
            onChange={(start, end) => onChange({ ...value, start, end })}
            onDuration={(d) => {
              if (value.end === 0)
                onChange({ ...value, start: 0, end: Math.min(d, GIF_DEFAULT_SECONDS) });
            }}
          />
        </Field>
      ) : null}
      <Field label={t('tools.video.gif.width')}>
        <ChipRow
          numeric
          options={GIF_WIDTHS.map((w) => ({ value: w, label: String(w) }))}
          value={value.width}
          onChange={(width) => onChange({ ...value, width })}
        />
      </Field>
      <Field label={t('tools.video.gif.fps')}>
        <ChipRow
          numeric
          options={GIF_FPS.map((w) => ({ value: w, label: String(w) }))}
          value={value.fps}
          onChange={(fps) => onChange({ ...value, fps })}
        />
      </Field>
      <Field label={t('tools.video.gif.colors')}>
        <ChipRow
          numeric
          options={GIF_COLORS.map((w) => ({ value: w, label: String(w) }))}
          value={value.colors}
          onChange={(colors) => onChange({ ...value, colors })}
        />
      </Field>
    </View>
  );
}
