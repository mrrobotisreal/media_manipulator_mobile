/**
 * Heal and red-eye (ticket MA51 decisions 5 and 6; web `panels/heal-panel.tsx`,
 * `panels/redeye-panel.tsx`). Heal: arm the spot brush, paint spots on the canvas, press Heal (one
 * `ai_ops` per press; the MA16 AI meter is shown here; a 429 opens the MA16 sheet). Hidden behind
 * an "unavailable" line when `capabilities.heal` is false. Red-eye: arm the tool, tap an eye.
 */
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { QuotaChip } from '@/quota/QuotaChip';
import { Button } from '@/ui/components/Button';
import { Text } from '@/ui/components/Text';
import { useToolState } from '../../tools/toolState';
import { useEditorTools, usePhotoSelector } from '../EditorContext';
import { ParamSlider } from '../ParamSlider';

export function HealSheet() {
  const { t } = useTranslation();
  const x = useEditorTools();
  const tool = useToolState(x.tools, (s) => s.tool);
  const strokes = useToolState(x.tools, (s) => s.healStrokes);
  const size = useToolState(x.tools, (s) => s.healSize);
  const radius = useToolState(x.tools, (s) => s.redEyeRadius);
  const heals = usePhotoSelector((s) => s.doc?.heals.length ?? 0);
  const phase = x.healState?.phase ?? 'idle';
  const available = x.capabilities?.heal !== false;

  return (
    <View className="gap-4" testID="photo-heal-sheet">
      <View className="gap-2">
        <Text className="font-semibold">{t('interface:photo.heal.title')}</Text>
        {!available ? (
          <Text testID="photo-heal-off" className="text-sm text-muted-fg">
            {t('interface:photo.heal.unavailable')}
          </Text>
        ) : (
          <>
            <Text className="text-sm text-muted-fg">{t('photo.heal.hint')}</Text>
            <QuotaChip metric="ai_ops" />
            <Button
              testID="photo-heal-brush"
              variant={tool === 'heal' ? 'primary' : 'secondary'}
              label={t('interface:photo.heal.brush')}
              onPress={() => x.tools.set({ tool: tool === 'heal' ? 'none' : 'heal' })}
            />
            <ParamSlider
              label={t('interface:photo.masks.brush.size')}
              value={size}
              min={4}
              max={500}
              defaultValue={40}
              undoLabel="brush"
              onValue={(v) => x.tools.set({ healSize: v })}
            />
            <Text testID="photo-heal-strokes" className="text-sm text-data">
              {t('interface:photo.heal.strokes', { count: strokes })}
            </Text>
            {phase === 'running' ? (
              <View className="gap-1" testID="photo-heal-running">
                <Text className="text-sm">
                  {t('photo.heal.running', { percent: Math.round(x.healState?.progress ?? 0) })}
                </Text>
              </View>
            ) : null}
            {phase === 'failed' ? (
              <Text testID="photo-heal-failed" className="text-sm text-primary">
                {t('interface:photo.heal.failed')}
              </Text>
            ) : null}
            <View className="flex-row flex-wrap gap-2">
              <Button
                testID="photo-heal-press"
                label={t('interface:photo.heal.press')}
                disabled={strokes === 0 || phase === 'running'}
                loading={phase === 'running'}
                onPress={() => void x.heal?.()}
              />
              <Button
                testID="photo-heal-clear"
                variant="secondary"
                label={t('interface:photo.heal.clear')}
                disabled={strokes === 0 || phase === 'running'}
                onPress={() => x.clearHealStrokes?.()}
              />
            </View>
            {heals > 0 ? (
              <Text className="text-sm text-muted-fg">
                {t('interface:photo.heal.done', { count: heals })}
              </Text>
            ) : null}
          </>
        )}
      </View>

      <View className="gap-2">
        <Text className="font-semibold">{t('interface:photo.redEye.title')}</Text>
        <Text className="text-sm text-muted-fg">{t('photo.redEye.hint')}</Text>
        <Button
          testID="photo-redeye-tool"
          variant={tool === 'redEye' ? 'primary' : 'secondary'}
          label={t('photo.redEye.tapEye')}
          onPress={() => x.tools.set({ tool: tool === 'redEye' ? 'none' : 'redEye' })}
        />
        <ParamSlider
          testID="photo-redeye-radius"
          label={t('interface:photo.redEye.radius')}
          value={radius}
          min={0.3}
          max={6}
          step={0.1}
          defaultValue={1.5}
          undoLabel="redEye"
          onValue={(v) => x.tools.set({ redEyeRadius: v })}
        />
      </View>
    </View>
  );
}
