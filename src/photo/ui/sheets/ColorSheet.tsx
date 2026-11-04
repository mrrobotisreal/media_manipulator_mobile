/**
 * Colour = HSL (design §5.1): the six Photoshop range chips, per-range hue / saturation / lightness,
 * and "Grey except this" per chip (saturation -100 on every other range). Custom ranges from the
 * eyedropper are MA51; a doc that already has them shows them as chips too.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/ui/components/Button';
import { Chips } from '@/ui/components/Chips';
import { Text } from '@/ui/components/Text';
import { greyExceptRange, hslRanges, nestedOf, setNested, setRange } from '../../edits';
import { HSL_RANGE_IDS } from '../../photoTypes';
import { useEdit, usePhotoSelector } from '../EditorContext';
import { ParamSlider } from '../ParamSlider';

const MASTER = 'master';
const isDefault = (id: string) => (HSL_RANGE_IDS as readonly string[]).includes(id);

// i18n-keys: interface:photo.hsl.range.reds, interface:photo.hsl.range.yellows, interface:photo.hsl.range.greens, interface:photo.hsl.range.cyans, interface:photo.hsl.range.blues, interface:photo.hsl.range.magentas
export function ColorSheet() {
  const { t } = useTranslation();
  const doc = usePhotoSelector((s) => s.doc);
  const { edit } = useEdit();
  const ranges = hslRanges(doc);
  const [sel, setSel] = useState<string>(MASTER);
  const range = ranges.find((r) => r.id === sel);
  const label = (id: string, i: number) =>
    isDefault(id)
      ? t(`interface:photo.hsl.range.${id}`)
      : t('interface:photo.hsl.custom', { index: i + 1 });

  const options = [
    { value: MASTER, label: t('interface:photo.hsl.master') },
    ...ranges.map((r, i) => ({ value: r.id, label: label(r.id, i - 5) })),
  ];
  const keys = ['hue', 'saturation', 'lightness'] as const;
  const bounds = { hue: [-180, 180], saturation: [-100, 100], lightness: [-100, 100] } as const;

  return (
    <View className="gap-3">
      <Chips options={options} value={sel} onChange={setSel} testIDPrefix="photo-hsl" />
      {keys.map((k) => (
        <ParamSlider
          key={`${sel}-${k}`}
          testID={`photo-hsl-${k}`}
          label={t(`interface:photo.hsl.${k}`)}
          value={sel === MASTER ? nestedOf(doc, 'hsl', ['master', k], 0) : (range?.[k] ?? 0)}
          min={bounds[k][0]}
          max={bounds[k][1]}
          undoLabel="hsl"
          onValue={(v) =>
            edit(
              'hsl',
              (d) =>
                sel === MASTER ? setNested(d, 'hsl', ['master', k], v) : setRange(d, sel, k, v),
              ['hsl', k],
            )
          }
        />
      ))}
      {sel !== MASTER ? (
        <View className="gap-1">
          <Button
            testID="photo-grey-except"
            variant="secondary"
            label={t('photo.greyExcept')}
            onPress={() => edit('hsl', (d) => greyExceptRange(d, sel), ['hsl', 'saturation'])}
          />
          <Text className="text-sm text-subtle">
            {t('interface:photo.hsl.greyExceptNamed', {
              name: label(sel, ranges.findIndex((r) => r.id === sel) - 5),
            })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
