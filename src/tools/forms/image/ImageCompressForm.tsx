import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Chips } from '@/ui/components/Chips';
import { Text } from '@/ui/components/Text';
import { compressFormat, type CompressForm } from '../../options/image';
import type { ToolFormProps } from '../../types';
import { FieldLabel, QualityField } from './shared';

export function ImageCompressForm({ value, onChange, ctx }: ToolFormProps<CompressForm>) {
  const { t } = useTranslation();
  const resolved = compressFormat(value, ctx);
  const png = ctx?.input?.extension === 'png' && resolved === 'jpg';
  return (
    <View className="gap-4">
      <View className="gap-2">
        <FieldLabel>{t('tools.image.format')}</FieldLabel>
        <Chips
          label={t('tools.image.format')}
          options={[
            {
              value: 'same' as CompressForm['format'],
              label: t('tools.image.sameAsOriginal', {
                format: t(`tools.image.formats.${resolved}`),
              }),
            },
            { value: 'jpg', label: t('tools.image.formats.jpg') },
            { value: 'webp', label: t('tools.image.formats.webp') },
          ]}
          value={value.format}
          onChange={(format) => onChange({ ...value, format })}
        />
      </View>
      {png ? (
        <Text className="text-sm text-muted-fg">{t('tools.image.compress.pngToJpg')}</Text>
      ) : null}
      <QualityField value={value.quality} onChange={(quality) => onChange({ ...value, quality })} />
    </View>
  );
}
