import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Slider } from '@/ui/components/Slider';
import { Stepper } from '@/ui/components/Stepper';
import { Text } from '@/ui/components/Text';
import type { SvgForm } from '../../options/image';
import type { ToolFormProps } from '../../types';

export function ImageToSvgForm({ value, onChange }: ToolFormProps<SvgForm>) {
  const { t } = useTranslation();
  return (
    <View className="gap-4">
      <Text className="text-sm text-muted-fg">{t('interface:imageForm.vectorize.note')}</Text>
      <Slider
        label={t('interface:imageForm.vectorize.thresholdLabel')}
        value={value.threshold}
        min={1}
        max={99}
        onChange={(threshold) => onChange({ ...value, threshold })}
      />
      <Stepper
        label={t('tools.image.vectorize.speckle', { count: value.turdSize })}
        value={value.turdSize}
        min={0}
        max={1000}
        onChange={(turdSize) => onChange({ ...value, turdSize })}
      />
    </View>
  );
}
