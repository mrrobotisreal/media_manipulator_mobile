import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Field } from '@/ui/components/Field';
import { Chips } from '@/ui/components/Chips';
import { TrimRangeScrubber } from '../../native/TrimRangeScrubber';
import {
  GIF_COLORS,
  GIF_DEFAULT_SECONDS,
  GIF_FPS,
  GIF_WIDTHS,
  type GifForm,
} from '../../options/video';
import type { ToolFormProps } from '../../types';

export function VideoToGifForm({ value, onChange, ctx }: ToolFormProps<GifForm>) {
  const { t } = useTranslation();
  return (
    <View className="gap-4" testID="video-to-gif-form">
      {ctx?.input?.uri ? (
        <Field hint={t('tools.video.gif.rangeHint')}>
          <TrimRangeScrubber
            uri={ctx.input.uri}
            durationSec={ctx.input.durationSec}
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
        <Chips
          options={GIF_WIDTHS.map((w) => ({ value: w, label: String(w) }))}
          value={value.width}
          onChange={(width) => onChange({ ...value, width })}
        />
      </Field>
      <Field label={t('tools.video.gif.fps')}>
        <Chips
          options={GIF_FPS.map((w) => ({ value: w, label: String(w) }))}
          value={value.fps}
          onChange={(fps) => onChange({ ...value, fps })}
        />
      </Field>
      <Field label={t('tools.video.gif.colors')}>
        <Chips
          options={GIF_COLORS.map((w) => ({ value: w, label: String(w) }))}
          value={value.colors}
          onChange={(colors) => onChange({ ...value, colors })}
        />
      </Field>
    </View>
  );
}
