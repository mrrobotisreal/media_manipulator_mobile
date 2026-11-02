import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Chips } from '@/ui/components/Chips';
import { Text } from '@/ui/components/Text';
import { TextField } from '@/ui/components/TextField';
import { useFactText } from '@/quota/useTierFacts';
import { resizeBlockReason, type ResizeForm } from '../../options/image';
import type { ToolFormProps } from '../../types';
import { FieldLabel, SameFormatField } from './shared';

const PERCENTS = [25, 50, 75] as const;
const WIDES = [1080, 1920] as const;

const toInt = (s: string): number | undefined => {
  const n = Number.parseInt(s.replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? Math.min(4096, n) : undefined;
};

export function ImageResizeForm({ value, onChange, ctx }: ToolFormProps<ResizeForm>) {
  const { t } = useTranslation();
  const fact = useFactText('maxOutputHeight');
  const [selected, setSelected] = useState<string | null>(null);
  const blocked = resizeBlockReason(value, ctx) === 'output_height';
  const srcW = ctx?.input?.width;
  const srcH = ctx?.input?.height;

  const keepAspectChange = (keepAspect: boolean) => onChange({ ...value, keepAspect });
  const presetOptions = [
    ...(srcW
      ? PERCENTS.map((p) => ({
          value: `p${p}`,
          label: t('tools.image.resize.presetPercent', { percent: p }),
        }))
      : []),
    ...WIDES.map((w) => ({
      value: `w${w}`,
      label: t('tools.image.resize.presetWide', { width: w }),
    })),
  ];
  const applyPreset = (id: string) => {
    setSelected(id);
    if (id.startsWith('p') && srcW) {
      const pct = Number(id.slice(1)) / 100;
      onChange({
        ...value,
        width: Math.max(1, Math.min(4096, Math.round(srcW * pct))),
        height: srcH ? Math.max(1, Math.min(4096, Math.round(srcH * pct))) : value.height,
        lastEdited: 'width',
      });
    } else {
      onChange({ ...value, width: Number(id.slice(1)), lastEdited: 'width' });
    }
  };

  return (
    <View className="gap-4">
      <Chips options={presetOptions} value={selected} onChange={applyPreset} />
      <View className="flex-row gap-3">
        <View className="flex-1">
          <TextField
            label={t('tools.image.resize.width')}
            keyboardType="number-pad"
            value={value.width === undefined ? '' : String(value.width)}
            onChangeText={(s) => {
              setSelected(null);
              onChange({ ...value, width: toInt(s), lastEdited: 'width' });
            }}
          />
        </View>
        <View className="flex-1">
          <TextField
            label={t('tools.image.resize.height')}
            keyboardType="number-pad"
            value={value.height === undefined ? '' : String(value.height)}
            error={
              blocked
                ? t('tools.image.resize.heightLimit', { limit: ctx?.limits?.maxOutputHeight })
                : null
            }
            onChangeText={(s) => {
              setSelected(null);
              onChange({ ...value, height: toInt(s), lastEdited: 'height' });
            }}
          />
        </View>
      </View>
      {blocked && fact ? (
        <Text className="text-sm text-muted-fg" testID="height-limit-fact">
          {fact}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: value.keepAspect }}
        onPress={() => keepAspectChange(!value.keepAspect)}
        className="min-h-[44px] flex-row items-center justify-between"
      >
        <FieldLabel>{t('tools.image.resize.keepAspect')}</FieldLabel>
        <Text className={value.keepAspect ? 'font-semibold text-primary' : 'text-subtle'}>
          {value.keepAspect ? '●' : '○'}
        </Text>
      </Pressable>
      <SameFormatField
        value={value.format}
        onChange={(format) => onChange({ ...value, format })}
        ctx={ctx}
      />
    </View>
  );
}
