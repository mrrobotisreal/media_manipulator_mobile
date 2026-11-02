import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Chips } from '@/ui/components/Chips';
import { Slider } from '@/ui/components/Slider';
import { Text } from '@/ui/components/Text';
import { sameAsOriginalFormat, type PickFormat, type SameOrFormat } from '../../options/image';
import type { ToolContext } from '../../types';

export function FieldLabel({ children }: { children: string }) {
  return <Text className="text-sm text-muted-fg">{children}</Text>;
}

/** Output format for the "same as original" family: Same (resolved) / JPG / PNG / WebP. */
export function SameFormatField({
  value,
  onChange,
  ctx,
  allowed = ['jpg', 'png', 'webp'],
}: {
  value: SameOrFormat;
  onChange: (v: SameOrFormat) => void;
  ctx?: ToolContext;
  allowed?: PickFormat[];
}) {
  const { t } = useTranslation();
  const resolved = sameAsOriginalFormat(ctx?.input?.extension);
  const options = [
    {
      value: 'same' as SameOrFormat,
      label: t('tools.image.sameAsOriginal', { format: t(`tools.image.formats.${resolved}`) }),
    },
    ...allowed.map((f) => ({ value: f as SameOrFormat, label: t(`tools.image.formats.${f}`) })),
  ];
  return (
    <View className="gap-2">
      <FieldLabel>{t('tools.image.format')}</FieldLabel>
      <Chips options={options} value={value} onChange={onChange} label={t('tools.image.format')} />
    </View>
  );
}

export function QualityField({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <View className="gap-1">
      <Slider
        label={t('tools.image.quality')}
        value={value}
        min={1}
        max={100}
        onChange={onChange}
        format={(v) => `${v} %`}
      />
      <Text className="text-xs text-subtle">{t('tools.image.qualityHint')}</Text>
    </View>
  );
}
