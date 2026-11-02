import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Field } from '@/ui/components/Field';
import { ChipRow } from '@/ui/components/ChipRow';
import { Stepper } from '@/ui/components/Stepper';
import { ToggleRow } from '@/ui/components/ToggleRow';
import {
  SPEED_CHIPS,
  SPEED_FORMATS,
  SPEED_MAX,
  SPEED_MIN,
  type SpeedForm,
} from '../../options/video';
import type { ToolFormProps } from '../../types';
import { useFormatChips } from './shared';

export function VideoSpeedForm({ value, onChange, file }: ToolFormProps<SpeedForm>) {
  const { t } = useTranslation();
  const chips = useFormatChips(SPEED_FORMATS, file?.extension, true);
  const fmt = (v: number) => t('tools.video.speed.value', { speed: v });
  return (
    <View className="gap-4" testID="video-speed-form">
      <Field label={t('tools.video.speed.label')}>
        <ChipRow
          numeric
          options={SPEED_CHIPS.map((s) => ({ value: s, label: fmt(s) }))}
          value={value.speed}
          onChange={(speed) => onChange({ ...value, speed })}
        />
        <Stepper
          value={value.speed}
          min={SPEED_MIN}
          max={SPEED_MAX}
          step={0.05}
          format={fmt}
          decrementLabel={t('tools.video.stepperLess')}
          incrementLabel={t('tools.video.stepperMore')}
          onChange={(speed) => onChange({ ...value, speed })}
        />
      </Field>
      <ToggleRow
        label={t('tools.video.speed.reverse')}
        value={value.reverse}
        onChange={(reverse) => onChange({ ...value, reverse })}
      />
      <Field label={t('tools.video.format')}>
        <ChipRow
          options={chips}
          value={value.format}
          onChange={(format) => onChange({ ...value, format })}
        />
      </Field>
    </View>
  );
}
