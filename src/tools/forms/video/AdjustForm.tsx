import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Field } from '@/ui/components/Field';
import { ChipRow } from '@/ui/components/ChipRow';
import { Segmented } from '@/ui/components/Segmented';
import { Slider } from '@/ui/components/Slider';
import { Stepper } from '@/ui/components/Stepper';
import { Text } from '@/ui/components/Text';
import { SPEED_FORMATS, adjustValid, type AdjustForm, type AdjustOp } from '../../options/video';
import type { ToolFormProps } from '../../types';
import { useFormatChips } from './shared';

const FPS_CHIPS = [24, 25, 30, 50, 60];

export function VideoAdjustForm({ value, onChange, file }: ToolFormProps<AdjustForm>) {
  const { t } = useTranslation();
  const set = (patch: Partial<AdjustForm>) => onChange({ ...value, ...patch });
  const chips = useFormatChips(SPEED_FORMATS, file?.extension, true);
  const slider = (
    key: 'brightness' | 'contrast' | 'saturation' | 'hue' | 'gamma' | 'shakiness' | 'accuracy',
    min: number,
    max: number,
    step: number,
    label: string,
  ) => (
    <Slider
      label={label}
      value={value[key]}
      min={min}
      max={max}
      step={step}
      format={key === 'gamma' ? (v) => v.toFixed(1) : undefined}
      onChange={(v) => set({ [key]: v } as Partial<AdjustForm>)}
    />
  );
  return (
    <View className="gap-4" testID="video-adjust-form">
      <Segmented<AdjustOp>
        options={[
          { value: 'stabilize', label: t('tools.video.adjust.op.stabilize') },
          { value: 'frameRate', label: t('tools.video.adjust.op.frameRate') },
          { value: 'color', label: t('tools.video.adjust.op.color') },
        ]}
        value={value.adjust}
        onChange={(adjust) => set({ adjust })}
      />
      {value.adjust === 'stabilize' ? (
        <View className="gap-2">
          {slider('shakiness', 1, 10, 1, t('tools.video.adjust.shakiness'))}
          {slider('accuracy', 1, 15, 1, t('tools.video.adjust.accuracy'))}
        </View>
      ) : null}
      {value.adjust === 'frameRate' ? (
        <Field label={t('tools.video.adjust.target')}>
          <ChipRow
            numeric
            options={FPS_CHIPS.map((f) => ({ value: f, label: String(f) }))}
            value={FPS_CHIPS.includes(value.target) ? value.target : null}
            onChange={(target) => set({ target })}
          />
          <Stepper
            value={value.target}
            min={1}
            max={120}
            decrementLabel={t('tools.video.stepperLess')}
            incrementLabel={t('tools.video.stepperMore')}
            onChange={(target) => set({ target })}
          />
        </Field>
      ) : null}
      {value.adjust === 'color' ? (
        <View className="gap-1">
          {slider('brightness', -100, 100, 1, t('tools.video.adjust.brightness'))}
          {slider('contrast', -100, 100, 1, t('tools.video.adjust.contrast'))}
          {slider('saturation', -100, 100, 1, t('tools.video.adjust.saturation'))}
          {slider('hue', -180, 180, 1, t('tools.video.adjust.hue'))}
          {slider('gamma', 0.1, 3, 0.1, t('tools.video.adjust.gamma'))}
          {!adjustValid(value) ? (
            <Text className="text-sm text-subtle">{t('tools.video.adjust.noChange')}</Text>
          ) : null}
        </View>
      ) : null}
      <Field label={t('tools.video.format')}>
        <ChipRow options={chips} value={value.format} onChange={(format) => set({ format })} />
      </Field>
    </View>
  );
}
