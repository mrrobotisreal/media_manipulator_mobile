/**
 * Detail (ticket MA51 decision 7; web `panels/detail-panel.tsx`, same ranges and defaults): sharpen,
 * noise reduction, blur, clarity / texture / dehaze, vignette, grain. Each section edits one layer
 * of its type (created on first touch, like Basic). "100 %" zooms the canvas to actual pixels for
 * judging sharpening and noise.
 */
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/ui/components/Button';
import { Text } from '@/ui/components/Text';
import { paramOf, setParam } from '../../edits';
import type { LayerType } from '../../photoTypes';
import { useEdit, useEditorTools, usePhotoSelector } from '../EditorContext';
import { ParamSlider } from '../ParamSlider';

interface Row {
  type: LayerType;
  key: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  def: number;
}

const SECTIONS: { title: string; rows: Row[] }[] = [
  {
    title: 'sharpen.title',
    rows: [
      { type: 'sharpen', key: 'amount', label: 'sharpen.amount', min: 0, max: 500, def: 100 },
      {
        type: 'sharpen',
        key: 'radius',
        label: 'sharpen.radius',
        min: 0.1,
        max: 50,
        step: 0.1,
        def: 1,
      },
      { type: 'sharpen', key: 'threshold', label: 'sharpen.threshold', min: 0, max: 255, def: 0 },
    ],
  },
  {
    title: 'noise.title',
    rows: [
      {
        type: 'noiseReduction',
        key: 'luminance',
        label: 'noise.luminance',
        min: 0,
        max: 100,
        def: 0,
      },
      { type: 'noiseReduction', key: 'color', label: 'noise.color', min: 0, max: 100, def: 0 },
    ],
  },
  {
    title: 'blur.title',
    rows: [
      { type: 'blur', key: 'radius', label: 'blur.radius', min: 0, max: 100, step: 0.5, def: 0 },
    ],
  },
  {
    title: 'presence.title',
    rows: [
      { type: 'clarity', key: 'amount', label: 'presence.clarity', min: -100, max: 100, def: 0 },
      { type: 'texture', key: 'amount', label: 'presence.texture', min: -100, max: 100, def: 0 },
      { type: 'dehaze', key: 'amount', label: 'presence.dehaze', min: -100, max: 100, def: 0 },
    ],
  },
  {
    title: 'vignette.title',
    rows: [
      { type: 'vignette', key: 'amount', label: 'vignette.amount', min: -100, max: 100, def: 0 },
      { type: 'vignette', key: 'midpoint', label: 'vignette.midpoint', min: 0, max: 100, def: 50 },
      {
        type: 'vignette',
        key: 'roundness',
        label: 'vignette.roundness',
        min: -100,
        max: 100,
        def: 0,
      },
      { type: 'vignette', key: 'feather', label: 'vignette.feather', min: 0, max: 100, def: 50 },
      {
        type: 'vignette',
        key: 'highlights',
        label: 'vignette.highlights',
        min: 0,
        max: 100,
        def: 0,
      },
    ],
  },
  {
    title: 'grain.title',
    rows: [
      { type: 'grain', key: 'amount', label: 'grain.amount', min: 0, max: 100, def: 0 },
      { type: 'grain', key: 'size', label: 'grain.size', min: 1, max: 3, def: 1 },
      { type: 'grain', key: 'roughness', label: 'grain.roughness', min: 0, max: 100, def: 50 },
    ],
  },
];

// i18n-keys: interface:photo.detail.sharpen.title, interface:photo.detail.sharpen.amount, interface:photo.detail.sharpen.radius, interface:photo.detail.sharpen.threshold, interface:photo.detail.noise.title, interface:photo.detail.noise.luminance, interface:photo.detail.noise.color, interface:photo.detail.blur.title, interface:photo.detail.blur.radius, interface:photo.detail.presence.title, interface:photo.detail.presence.clarity, interface:photo.detail.presence.texture, interface:photo.detail.presence.dehaze, interface:photo.detail.vignette.title, interface:photo.detail.vignette.amount, interface:photo.detail.vignette.midpoint, interface:photo.detail.vignette.roundness, interface:photo.detail.vignette.feather, interface:photo.detail.vignette.highlights, interface:photo.detail.grain.title, interface:photo.detail.grain.amount, interface:photo.detail.grain.size, interface:photo.detail.grain.roughness
export function DetailSheet() {
  const { t } = useTranslation();
  const doc = usePhotoSelector((s) => s.doc);
  const { edit } = useEdit();
  const x = useEditorTools();
  return (
    <View className="gap-4" testID="photo-detail-sheet">
      <View className="gap-1">
        <Button
          testID="photo-detail-100"
          variant="secondary"
          label={t('interface:photo.detail.judge')}
          onPress={() => x.tools.set({ zoomActual: x.tools.get().zoomActual + 1 })}
        />
        <Text className="text-sm text-muted-fg">{t('interface:photo.detail.judgeHint')}</Text>
      </View>
      {SECTIONS.map((sec) => (
        <View key={sec.title} className="gap-1">
          <Text className="font-semibold">{t(`interface:photo.detail.${sec.title}`)}</Text>
          {sec.rows.map((r) => (
            <ParamSlider
              key={`${r.type}.${r.key}`}
              testID={`photo-${r.type}-${r.key}`}
              label={t(`interface:photo.detail.${r.label}`)}
              value={paramOf(doc, r.type, r.key, r.def)}
              min={r.min}
              max={r.max}
              step={r.step ?? 1}
              defaultValue={r.def}
              undoLabel={r.type}
              onValue={(v) => edit(r.type, (d) => setParam(d, r.type, r.key, v), [r.type, r.key])}
            />
          ))}
        </View>
      ))}
    </View>
  );
}
