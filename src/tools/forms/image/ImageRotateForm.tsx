import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Segmented } from '@/ui/components/Segmented';
import type { RotateForm, Rotation } from '../../options/image';
import type { ToolFormProps } from '../../types';
import { SameFormatField } from './shared';

export function ImageRotateForm({ value, onChange, ctx }: ToolFormProps<RotateForm>) {
  const { t } = useTranslation();
  return (
    <View className="gap-4">
      <Segmented<Rotation>
        options={[
          { value: 'cw90', label: t('tools.image.rotate.cw90') },
          { value: 'r180', label: t('tools.image.rotate.r180') },
          { value: 'ccw90', label: t('tools.image.rotate.ccw90') },
        ]}
        value={value.rotation}
        onChange={(rotation) => onChange({ ...value, rotation })}
      />
      <SameFormatField
        value={value.format}
        onChange={(format) => onChange({ ...value, format })}
        ctx={ctx}
      />
    </View>
  );
}
