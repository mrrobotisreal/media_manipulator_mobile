import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Chips, MultiChips } from '@/ui/components/Chips';
import { ICO_SIZES, type ConvertForm } from '../../options/image';
import type { ToolFormProps } from '../../types';
import { FieldLabel, QualityField } from './shared';

const FORMATS: ConvertForm['format'][] = ['jpg', 'png', 'webp', 'gif', 'avif', 'ico'];

export function ImageConvertForm({ value, onChange }: ToolFormProps<ConvertForm>) {
  const { t } = useTranslation();
  const set = (patch: Partial<ConvertForm>) => onChange({ ...value, ...patch });
  const showQuality = value.format === 'jpg' || value.format === 'webp';
  return (
    <View className="gap-4">
      <View className="gap-2">
        <FieldLabel>{t('tools.image.format')}</FieldLabel>
        <Chips
          label={t('tools.image.format')}
          options={FORMATS.map((f) => ({ value: f, label: t(`tools.image.formats.${f}`) }))}
          value={value.format}
          onChange={(format) => set({ format })}
        />
      </View>
      {showQuality ? (
        <QualityField value={value.quality} onChange={(quality) => set({ quality })} />
      ) : null}
      {value.format === 'ico' ? (
        <View className="gap-2">
          <FieldLabel>{t('tools.image.icoSizes')}</FieldLabel>
          <MultiChips
            label={t('tools.image.icoSizes')}
            options={ICO_SIZES.map((s) => ({ value: s as number, label: String(s) }))}
            value={value.icoSizes}
            onToggle={(s) => {
              const has = value.icoSizes.includes(s);
              // Keep at least one size selected.
              if (has && value.icoSizes.length === 1) return;
              set({
                icoSizes: has ? value.icoSizes.filter((x) => x !== s) : [...value.icoSizes, s],
              });
            }}
          />
        </View>
      ) : null}
    </View>
  );
}
