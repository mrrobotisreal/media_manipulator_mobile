/** Basic: exposure, brightness/contrast, tone ×4, white balance, vibrance/saturation (design §5.1). */
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Text } from '@/ui/components/Text';
import { paramOf, setParam } from '../../edits';
import type { LayerType } from '../../photoTypes';
import { useEdit, usePhotoSelector } from '../EditorContext';
import { ParamSlider } from '../ParamSlider';

interface Row {
  type: LayerType;
  key: string;
  min: number;
  max: number;
  step: number;
  def: number;
}
const SECTIONS: { type: LayerType; rows: Row[] }[] = [
  {
    type: 'exposure',
    rows: [
      { type: 'exposure', key: 'ev', min: -5, max: 5, step: 0.05, def: 0 },
      { type: 'exposure', key: 'offset', min: -0.5, max: 0.5, step: 0.01, def: 0 },
      { type: 'exposure', key: 'gamma', min: 0.1, max: 10, step: 0.05, def: 1 },
    ],
  },
  {
    type: 'brightnessContrast',
    rows: [
      { type: 'brightnessContrast', key: 'brightness', min: -100, max: 100, step: 1, def: 0 },
      { type: 'brightnessContrast', key: 'contrast', min: -100, max: 100, step: 1, def: 0 },
    ],
  },
  {
    type: 'tone',
    rows: (['highlights', 'shadows', 'whites', 'blacks'] as const).map((key) => ({
      type: 'tone' as const,
      key,
      min: -100,
      max: 100,
      step: 1,
      def: 0,
    })),
  },
  {
    type: 'whiteBalance',
    rows: [
      { type: 'whiteBalance', key: 'temperature', min: -100, max: 100, step: 1, def: 0 },
      { type: 'whiteBalance', key: 'tint', min: -100, max: 100, step: 1, def: 0 },
    ],
  },
  {
    type: 'vibranceSaturation',
    rows: [
      { type: 'vibranceSaturation', key: 'vibrance', min: -100, max: 100, step: 1, def: 0 },
      { type: 'vibranceSaturation', key: 'saturation', min: -100, max: 100, step: 1, def: 0 },
    ],
  },
];

// i18n-keys: interface:photo.params.exposure.title, interface:photo.params.exposure.ev, interface:photo.params.exposure.offset, interface:photo.params.exposure.gamma, interface:photo.params.brightnessContrast.title, interface:photo.params.brightnessContrast.brightness, interface:photo.params.brightnessContrast.contrast, interface:photo.params.tone.title, interface:photo.params.tone.highlights, interface:photo.params.tone.shadows, interface:photo.params.tone.whites, interface:photo.params.tone.blacks, interface:photo.params.whiteBalance.title, interface:photo.params.whiteBalance.temperature, interface:photo.params.whiteBalance.tint, interface:photo.params.vibranceSaturation.title, interface:photo.params.vibranceSaturation.vibrance, interface:photo.params.vibranceSaturation.saturation
export function BasicSheet() {
  const { t } = useTranslation();
  const doc = usePhotoSelector((s) => s.doc);
  const { edit } = useEdit();
  return (
    <View className="gap-4">
      {SECTIONS.map((sec) => (
        <View key={sec.type} className="gap-1">
          <Text className="font-semibold">{t(`interface:photo.params.${sec.type}.title`)}</Text>
          {sec.rows.map((r) => (
            <ParamSlider
              key={r.key}
              testID={`photo-${r.type}-${r.key}`}
              label={t(`interface:photo.params.${r.type}.${r.key}`)}
              value={paramOf(doc, r.type, r.key, r.def)}
              min={r.min}
              max={r.max}
              step={r.step}
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
