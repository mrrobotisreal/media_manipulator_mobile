/**
 * Levels (design §5.1): per-channel input black / white / midtones and output black / white over
 * the live histogram (`histogram.ts`, 64 bins). Black stays below white (`setLevelsField`).
 * The histogram backdrop is LTR like every graph.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/ui/components/Button';
import { Segmented } from '@/ui/components/Segmented';
import { levelsOf, setLevels } from '../../edits';
import { gammaToPos, posToGamma, type LevelsField } from '../../levelsEdit';
import type { Histogram64 } from '../../histogram';
import type { LevelsChannel } from '../../photoTypes';
import { useEdit, usePhotoSelector } from '../EditorContext';
import { HistogramView } from '../HistogramView';
import { ParamSlider } from '../ParamSlider';

const FIELDS: LevelsField[] = ['inBlack', 'inWhite', 'gamma', 'outBlack', 'outWhite'];
const pct = (v: number) => String(Math.round(v * 255));

export function LevelsSheet({ histogram }: { histogram: Histogram64 | null }) {
  const { t } = useTranslation();
  const doc = usePhotoSelector((s) => s.doc);
  const { edit } = useEdit();
  const [ch, setCh] = useState<LevelsChannel>('master');
  const v = levelsOf(doc, ch);
  const options = (['master', 'r', 'g', 'b'] as const).map((value) => ({
    value,
    label: t(`interface:photo.levels.channel.${value}`),
  }));
  return (
    <View className="gap-3">
      <Segmented options={options} value={ch} onChange={setCh} />
      <HistogramView histogram={histogram} channel={ch} levels={v} />
      {FIELDS.map((f) =>
        f === 'gamma' ? (
          <ParamSlider
            key={f}
            testID="photo-levels-gamma"
            label={t('interface:photo.levels.gamma')}
            value={gammaToPos(v.gamma)}
            min={0}
            max={1}
            step={0.005}
            defaultValue={0.5}
            format={(p) => posToGamma(p).toFixed(2)}
            undoLabel="levels"
            onValue={(p) =>
              edit('levels', (d) => setLevels(d, ch, 'gamma', posToGamma(p)), ['levels', 'gamma'])
            }
          />
        ) : (
          <ParamSlider
            key={f}
            testID={`photo-levels-${f}`}
            label={t(`interface:photo.levels.${f}`)}
            value={v[f]}
            min={0}
            max={1}
            step={1 / 255}
            defaultValue={f === 'inWhite' || f === 'outWhite' ? 1 : 0}
            format={pct}
            undoLabel="levels"
            onValue={(x) => edit('levels', (d) => setLevels(d, ch, f, x), ['levels', f])}
          />
        ),
      )}
      <Button
        variant="ghost"
        label={t('interface:photo.levels.reset')}
        onPress={() =>
          edit('levels', (d) =>
            FIELDS.reduce(
              (acc, f) =>
                setLevels(acc, ch, f, f === 'inWhite' || f === 'outWhite' || f === 'gamma' ? 1 : 0),
              d,
            ),
          )
        }
      />
    </View>
  );
}
