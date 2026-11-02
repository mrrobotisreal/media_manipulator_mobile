import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Chips } from '@/ui/components/Chips';
import { Stepper } from '@/ui/components/Stepper';
import { Swatches } from '@/ui/components/Swatches';
import { Text } from '@/ui/components/Text';
import { TextField } from '@/ui/components/TextField';
import { textBlockReason, type TextForm } from '../../options/image';
import { TEXT_FONTS, TEXT_GRAVITIES } from '../../options/imageSchema';
import type { ToolFormProps } from '../../types';
import { FieldLabel, SameFormatField } from './shared';

export function ImageTextForm({ value, onChange, ctx }: ToolFormProps<TextForm>) {
  const { t } = useTranslation();
  const set = (patch: Partial<TextForm>) => onChange({ ...value, ...patch });
  const empty = textBlockReason(value) !== null;
  return (
    <View className="gap-4">
      <TextField
        label={t('interface:imageForm.textOverlay.overlayText')}
        value={value.text}
        maxLength={500}
        multiline
        onChangeText={(text) => set({ text })}
        error={empty && value.text.length > 0 ? t('tools.image.text.required') : null}
        helper={empty ? t('tools.image.text.required') : undefined}
      />
      <Stepper
        label={t('interface:imageForm.textOverlay.size')}
        value={value.size}
        min={8}
        max={512}
        step={4}
        onChange={(size) => set({ size })}
      />
      <View className="gap-2">
        <FieldLabel>{t('interface:imageForm.textOverlay.textColor')}</FieldLabel>
        <Swatches value={value.color} onChange={(color) => set({ color })} />
      </View>
      <View className="gap-2">
        <FieldLabel>{t('interface:imageForm.textOverlay.strokeColor')}</FieldLabel>
        <Swatches value={value.strokeColor} onChange={(strokeColor) => set({ strokeColor })} />
      </View>
      <Stepper
        label={t('interface:imageForm.textOverlay.strokeWidth')}
        value={value.strokeWidth}
        min={0}
        max={32}
        onChange={(strokeWidth) => set({ strokeWidth })}
      />
      <View className="gap-2">
        <FieldLabel>{t('interface:imageForm.textOverlay.position')}</FieldLabel>
        <View className="flex-row flex-wrap" style={{ direction: 'ltr', width: 3 * 52 }}>
          {TEXT_GRAVITIES.map((g) => {
            const selected = value.gravity === g;
            return (
              <Pressable
                key={g}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={t(`interface:imageForm.textOverlay.gravity.${g}`)}
                onPress={() => set({ gravity: g })}
                className={`m-0.5 items-center justify-center rounded-md border ${
                  selected ? 'border-primary bg-surface-3' : 'border-edge-control bg-surface-2'
                }`}
                style={{ width: 48, height: 48 }}
              >
                <Text className={selected ? 'text-primary' : 'text-subtle'}>●</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View className="gap-2">
        <FieldLabel>{t('tools.image.text.font')}</FieldLabel>
        <Chips
          options={TEXT_FONTS.map((f) => ({
            value: f,
            label: f === 'default' ? t('tools.image.text.fontDefault') : f.replace(/-/g, ' '),
          }))}
          value={value.font ?? 'default'}
          onChange={(font) => set({ font })}
        />
      </View>
      <Stepper
        label={t('interface:imageForm.textOverlay.xOffset')}
        value={value.x}
        min={0}
        max={4096}
        step={10}
        onChange={(x) => set({ x })}
      />
      <Stepper
        label={t('interface:imageForm.textOverlay.yOffset')}
        value={value.y}
        min={0}
        max={4096}
        step={10}
        onChange={(y) => set({ y })}
      />
      <SameFormatField value={value.format} onChange={(format) => set({ format })} ctx={ctx} />
    </View>
  );
}
