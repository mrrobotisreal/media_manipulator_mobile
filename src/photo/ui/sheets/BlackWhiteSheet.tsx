/** B&W (design §5.1): six colour-range mixers (Photoshop defaults) and an optional tint. */
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { ToggleRow } from '@/ui/components/ToggleRow';
import { layerOfType, paramOf, setFlag, setParam } from '../../edits';
import { useEdit, usePhotoSelector } from '../EditorContext';
import { ParamSlider } from '../ParamSlider';

export const BW_DEFAULTS = {
  reds: 40,
  yellows: 60,
  greens: 40,
  cyans: 60,
  blues: 20,
  magentas: 80,
} as const;

export function BlackWhiteSheet() {
  const { t } = useTranslation();
  const doc = usePhotoSelector((s) => s.doc);
  const { edit } = useEdit();
  const tint = layerOfType(doc, 'blackWhite')?.params.tint ?? null;
  return (
    <View className="gap-2">
      {(Object.keys(BW_DEFAULTS) as (keyof typeof BW_DEFAULTS)[]).map((k) => (
        <ParamSlider
          key={k}
          testID={`photo-bw-${k}`}
          label={t(`interface:photo.blackWhite.${k}`)}
          value={paramOf(doc, 'blackWhite', k, BW_DEFAULTS[k])}
          min={-200}
          max={300}
          defaultValue={BW_DEFAULTS[k]}
          undoLabel="blackWhite"
          onValue={(v) =>
            edit('blackWhite', (d) => setParam(d, 'blackWhite', k, v), ['blackWhite', k])
          }
        />
      ))}
      <ToggleRow
        label={t('interface:photo.blackWhite.tint')}
        value={tint !== null}
        onChange={(on) =>
          edit(
            'blackWhite',
            (d) => setFlag(d, 'blackWhite', 'tint', on ? { hue: 35, saturation: 20 } : null),
            ['blackWhite', 'tint'],
          )
        }
      />
      {tint ? (
        <>
          <ParamSlider
            label={t('interface:photo.blackWhite.tintHue')}
            value={tint.hue}
            min={0}
            max={360}
            defaultValue={35}
            undoLabel="blackWhite"
            onValue={(v) =>
              edit('blackWhite', (d) => setFlag(d, 'blackWhite', 'tint', { ...tint, hue: v }), [
                'blackWhite',
                'tint',
              ])
            }
          />
          <ParamSlider
            label={t('interface:photo.blackWhite.tintSaturation')}
            value={tint.saturation}
            min={0}
            max={100}
            defaultValue={20}
            undoLabel="blackWhite"
            onValue={(v) =>
              edit(
                'blackWhite',
                (d) => setFlag(d, 'blackWhite', 'tint', { ...tint, saturation: v }),
                ['blackWhite', 'tint'],
              )
            }
          />
        </>
      ) : null}
    </View>
  );
}
