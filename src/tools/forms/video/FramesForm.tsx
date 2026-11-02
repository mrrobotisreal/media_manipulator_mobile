import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { Field } from '@/ui/components/Field';
import { ChipRow } from '@/ui/components/ChipRow';
import { NumberField } from '@/ui/components/NumberField';
import { Num, Text } from '@/ui/components/Text';
import { formatTenths } from '../../native/RangeTrack';
import { FramePicker } from '../../native/TrimRangeScrubber';
import { normalizeTimestamps, type FramesForm } from '../../options/video';
import type { ToolFormProps } from '../../types';

export function VideoExtractFramesForm({ value, onChange, file }: ToolFormProps<FramesForm>) {
  const { t } = useTranslation();
  const set = (patch: Partial<FramesForm>) => onChange({ ...value, ...patch });
  const moments = normalizeTimestamps(value.timestamps);
  return (
    <View className="gap-4" testID="video-extract-frames-form">
      <Field label={t('interface:extractFrames.modeLabel')}>
        <ChipRow
          options={[
            { value: 'every_n_seconds', label: t('interface:extractFrames.modes.every_n_seconds') },
            { value: 'fps', label: t('interface:extractFrames.modes.fps') },
            { value: 'timestamp', label: t('interface:extractFrames.modes.timestamp') },
          ]}
          value={value.frameMode}
          onChange={(frameMode) => set({ frameMode })}
        />
      </Field>
      {value.frameMode === 'every_n_seconds' ? (
        <NumberField
          label={t('interface:extractFrames.secondsBetween')}
          value={value.intervalSeconds}
          onValue={(n) => set({ intervalSeconds: n ?? 0 })}
        />
      ) : null}
      {value.frameMode === 'fps' ? (
        <NumberField
          label={t('interface:extractFrames.fpsLabel')}
          value={value.fps}
          onValue={(n) => set({ fps: n ?? 0 })}
        />
      ) : null}
      {value.frameMode === 'timestamp' ? (
        <View className="gap-3">
          {file?.uri ? (
            <FramePicker
              uri={file.uri}
              durationSec={file.durationSec}
              addLabel={t('tools.video.frames.addMoment')}
              onAdd={(time) =>
                set({ timestamps: normalizeTimestamps([...value.timestamps, time]) })
              }
            />
          ) : null}
          <Text className="text-sm text-muted-fg">
            {t('tools.video.frames.moments', { count: moments.length })}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {moments.map((m) => (
              <Pressable
                key={m}
                accessibilityRole="button"
                accessibilityLabel={t('tools.video.frames.remove', { time: formatTenths(m) })}
                onPress={() => set({ timestamps: moments.filter((x) => x !== m) })}
                style={{ minHeight: 44 }}
                className="flex-row items-center gap-2 rounded-md border border-edge-control bg-surface-1 px-3"
              >
                <Num>{formatTenths(m)}</Num>
                <Text className="text-muted-fg">×</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
      <Field label={t('interface:extractFrames.imageFormatLabel')}>
        <ChipRow
          options={[
            { value: 'jpg', label: 'JPG' },
            { value: 'png', label: 'PNG' },
            { value: 'webp', label: 'WebP' },
          ]}
          value={value.format}
          onChange={(format) => set({ format })}
        />
      </Field>
      <NumberField
        integer
        label={t('interface:extractFrames.maxFramesLabel')}
        value={value.maxFrames}
        onValue={(n) => set({ maxFrames: n ?? 0 })}
      />
    </View>
  );
}
