import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Segmented } from '@/ui/components/Segmented';
import type { PdfToImageForm as PdfToImageState } from '../../options/image';
import type { ToolFormProps } from '../../types';
import { FieldLabel, QualityField } from './shared';

const DPIS = [100, 150, 200, 300] as const;

export function PdfToImageForm({ value, onChange }: ToolFormProps<PdfToImageState>) {
  const { t } = useTranslation();
  const set = (patch: Partial<PdfToImageState>) => onChange({ ...value, ...patch });
  return (
    <View className="gap-4">
      <View className="gap-2">
        <FieldLabel>{t('tools.image.format')}</FieldLabel>
        <Segmented<'jpg' | 'png'>
          options={[
            { value: 'jpg', label: t('tools.image.formats.jpg') },
            { value: 'png', label: t('tools.image.formats.png') },
          ]}
          value={value.format}
          onChange={(format) => set({ format })}
        />
      </View>
      <View className="gap-2">
        <FieldLabel>{t('tools.pdf.pages')}</FieldLabel>
        <Segmented<'first' | 'all'>
          options={[
            { value: 'first', label: t('tools.pdf.pagesFirst') },
            { value: 'all', label: t('tools.pdf.pagesAll') },
          ]}
          value={value.pageSelection}
          onChange={(pageSelection) => set({ pageSelection })}
        />
      </View>
      <View className="gap-2">
        <FieldLabel>{t('tools.pdf.dpi', { dpi: value.dpi })}</FieldLabel>
        <Segmented<string>
          options={DPIS.map((d) => ({ value: String(d), label: String(d) }))}
          value={String(value.dpi)}
          onChange={(d) => set({ dpi: Number(d) as PdfToImageState['dpi'] })}
        />
      </View>
      {value.format === 'jpg' ? (
        <QualityField value={value.quality} onChange={(quality) => set({ quality })} />
      ) : null}
    </View>
  );
}
