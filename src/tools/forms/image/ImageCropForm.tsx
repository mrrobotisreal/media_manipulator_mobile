import { Image } from 'expo-image';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/components/Button';
import { Chips } from '@/ui/components/Chips';
import { Text } from '@/ui/components/Text';
import type { CropAspect, CropForm } from '../../options/image';
import { aspectValue } from '../../native/cropMath';
import type { CropRectEditorProps } from '../../native/CropRectEditor';
import type { ToolFormProps } from '../../types';
import { SameFormatField } from './shared';

const ASPECTS: CropAspect[] = ['free', '1:1', '4:3', '3:4', '16:9', '9:16'];

/**
 * The editor needs the EXIF-oriented size, which expo-image reports from `onLoad` (the picker's
 * width/height can be un-oriented). The probe image is invisible; the picker size is only a fallback.
 */
/** Lazy: keeps reanimated/worklets out of the registry import graph (jest never loads the native runtime). */
function CropRectEditor(props: CropRectEditorProps) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Editor = require('../../native/CropRectEditor')
    .CropRectEditor as typeof import('../../native/CropRectEditor').CropRectEditor;
  return <Editor {...props} />;
}

export function ImageCropForm({ value, onChange, ctx }: ToolFormProps<CropForm>) {
  const { t } = useTranslation();
  const uri = ctx?.input?.uri;
  const [loaded, setLoaded] = useState<{ width: number; height: number } | null>(null);
  const size =
    loaded ??
    (ctx?.input?.width && ctx.input.height
      ? { width: ctx.input.width, height: ctx.input.height }
      : null);

  if (!uri) return <Text className="text-sm text-muted-fg">{t('tools.image.crop.pick')}</Text>;
  return (
    <View className="gap-4">
      {!loaded ? (
        <Image
          source={{ uri }}
          style={{ width: 1, height: 1, opacity: 0 }}
          onLoad={(e) => setLoaded({ width: e.source.width, height: e.source.height })}
        />
      ) : null}
      {size ? (
        <CropRectEditor
          uri={uri}
          sourceWidth={size.width}
          sourceHeight={size.height}
          value={value.rect}
          aspect={aspectValue(value.aspect)}
          onChange={(rect) => onChange({ ...value, rect })}
        />
      ) : null}
      <Chips
        options={ASPECTS.map((a) => ({
          value: a,
          label: a === 'free' ? t('toolUi.crop.aspectFree') : a,
        }))}
        value={value.aspect}
        onChange={(aspect) => onChange({ ...value, aspect })}
      />
      <Button
        variant="ghost"
        label={t('toolUi.crop.reset')}
        onPress={() => onChange({ ...value, rect: null })}
      />
      <SameFormatField
        value={value.format}
        onChange={(format) => onChange({ ...value, format })}
        ctx={ctx}
      />
    </View>
  );
}
