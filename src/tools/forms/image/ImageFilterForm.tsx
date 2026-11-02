import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Chips } from '@/ui/components/Chips';
import { FILTER_IDS, type FilterForm } from '../../options/image';
import type { ToolFormProps } from '../../types';
import { SameFormatField } from './shared';

export function ImageFilterForm({ value, onChange, ctx }: ToolFormProps<FilterForm>) {
  const { t } = useTranslation();
  return (
    <View className="gap-4">
      <Chips
        options={FILTER_IDS.map((f) => ({ value: f, label: t(`tools.image.filters.${f}`) }))}
        value={value.filter}
        onChange={(filter) => onChange({ ...value, filter })}
      />
      <SameFormatField
        value={value.format}
        onChange={(format) => onChange({ ...value, format })}
        ctx={ctx}
      />
    </View>
  );
}
