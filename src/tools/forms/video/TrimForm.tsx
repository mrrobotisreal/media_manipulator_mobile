import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Field } from '@/ui/components/Field';
import { ChipRow } from '@/ui/components/ChipRow';
import { ToggleRow } from '@/ui/components/ToggleRow';
import { Text } from '@/ui/components/Text';
import { TrimRangeScrubber } from '../../native/TrimRangeScrubber';
import { TRIM_FORMATS, trimRangeValid, type TrimForm } from '../../options/video';
import type { ToolFormProps } from '../../types';
import { useFormatChips } from './shared';

export function VideoTrimForm({ value, onChange, file }: ToolFormProps<TrimForm>) {
  const { t } = useTranslation();
  const chips = useFormatChips(TRIM_FORMATS, file?.extension, true);
  const invalid = value.end > 0 && !trimRangeValid(value.start, value.end);
  return (
    <View className="gap-4" testID="video-trim-form">
      {file?.uri ? (
        <TrimRangeScrubber
          uri={file.uri}
          durationSec={file.durationSec}
          start={value.start}
          end={value.end}
          onChange={(start, end) => onChange({ ...value, start, end })}
          onDuration={(d) => {
            if (value.end === 0) onChange({ ...value, start: 0, end: d });
          }}
        />
      ) : null}
      {invalid ? (
        <Text className="text-sm text-danger" accessibilityLiveRegion="polite">
          {t('interface:videoTrimmer.invalidRange')}
        </Text>
      ) : null}
      <Field label={t('tools.video.format')}>
        <ChipRow
          options={chips}
          value={value.format}
          onChange={(format) => onChange({ ...value, format })}
        />
      </Field>
      <ToggleRow
        label={t('interface:videoTrimmer.reencodeLabel')}
        hint={t('interface:videoTrimmer.reencodeHint')}
        value={value.reencode}
        onChange={(reencode) => onChange({ ...value, reencode })}
      />
    </View>
  );
}
