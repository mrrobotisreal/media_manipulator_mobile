/**
 * Geometry (ticket MA51 decision 4; web `panels/geometry-panel.tsx`): crop on the live canvas with
 * the aspect chips (Free · 1:1 · 4:3 · 3:2 · 16:9 · 9:16 · 4:5 · 5:4 · Original), straighten
 * (-45..45 with a grid, plus the "draw a line" tool), rotate 90 / 180 / 270, flip, perspective
 * (four corner handles on the canvas, auto-crop toggle) and the fill of empty corners. Every crop
 * change re-maps the masks (the web's `applyCropRemap`) in the same edit.
 */
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/ui/components/Button';
import { Chips } from '@/ui/components/Chips';
import { Swatches } from '@/ui/components/Swatches';
import { Text } from '@/ui/components/Text';
import { ToggleRow } from '@/ui/components/ToggleRow';
import { autoCropRect, geometryOutputSize, type AlphaImage } from '../../colorMath';
import { applyCropRemap, patchGeometry, rotateBy } from '../../geometryOps';
import type { Geometry, PhotoDoc } from '../../photoTypes';
import {
  ASPECT_PRESETS,
  aspectValue,
  fitAspectRect,
  normalizeCrop,
  type AspectPreset,
} from '../../toolMath';
import { useToolState } from '../../tools/toolState';
import { useEdit, useEditor, useEditorTools, usePhotoSelector } from '../EditorContext';
import { ParamSlider } from '../ParamSlider';
import type { PngEncoder } from '../../brushEngine';

// The straighten slider keeps the 90-degree steps: rotate = step + fine.
const stepOf = (r: number) => Math.round(r / 90) * 90;

export function GeometrySheet({
  encodePng,
  brushAlpha,
}: {
  encodePng: PngEncoder;
  brushAlpha: (png: string) => AlphaImage | null;
}) {
  const { t } = useTranslation();
  const { edit } = useEdit();
  const { store } = useEditor();
  const x = useEditorTools();
  const doc = usePhotoSelector((s) => s.doc);
  const tool = useToolState(x.tools, (s) => s.tool);
  const aspect = useToolState(x.tools, (s) => s.aspect);
  if (!doc) return null;
  const g = doc.geometry;
  const step = stepOf(g.rotate);
  const fine = Math.round((g.rotate - step) * 10) / 10;
  const src = x.sourceSize;

  const crop = async (next: { x: number; y: number; width: number; height: number } | null) => {
    const d = store.getState().doc;
    if (!d) return;
    const out = await applyCropRemap(d, next, encodePng, async (png) => brushAlpha(png));
    edit('crop', () => out);
  };

  const chooseAspect = (a: AspectPreset) => {
    x.tools.set({ aspect: a, tool: 'crop' });
    const v = aspectValue(a, src.width, src.height);
    if (v === null) return;
    const canvas = geometryOutputSize({ ...g, crop: null }, src.width, src.height);
    void crop(normalizeCrop(fitAspectRect(v, canvas.width, canvas.height)));
  };

  const autoCrop = (on: boolean) =>
    edit('autoCrop', (d: PhotoDoc) => {
      if (!on) return patchGeometry(d, { crop: null });
      const r = autoCropRect({ ...d.geometry, crop: null }, src.width, src.height);
      return patchGeometry(d, { crop: normalizeCrop(r) });
    });

  const fillValue: 'transparent' | 'edge' | 'color' =
    g.fill === 'transparent' || g.fill === 'edge' ? g.fill : 'color';
  const geo = (label: string, patch: Partial<Geometry>) =>
    edit(label, (d) => patchGeometry(d, patch));

  return (
    <View className="gap-4" testID="photo-geometry-sheet">
      <View className="gap-2">
        <Text className="font-semibold">{t('interface:photo.geometry.crop')}</Text>
        <Chips
          testIDPrefix="photo-aspect"
          label={t('interface:photo.geometry.aspect')}
          options={ASPECT_PRESETS.map((a) => ({
            value: a,
            label:
              a === 'free'
                ? t('interface:photo.geometry.free')
                : a === 'original'
                  ? t('interface:photo.geometry.original')
                  : a,
          }))}
          value={aspect}
          onChange={chooseAspect}
        />
        <View className="flex-row flex-wrap gap-2">
          <Button
            testID="photo-crop-tool"
            variant={tool === 'crop' ? 'primary' : 'secondary'}
            label={t('interface:photo.geometry.cropTool')}
            onPress={() => x.tools.set({ tool: tool === 'crop' ? 'none' : 'crop' })}
          />
          <Button
            testID="photo-crop-reset"
            variant="secondary"
            label={t('interface:photo.geometry.resetCrop')}
            disabled={!g.crop}
            onPress={() => void crop(null)}
          />
        </View>
      </View>

      <View className="gap-2">
        <Text className="font-semibold">{t('interface:photo.geometry.straighten')}</Text>
        <ParamSlider
          testID="photo-straighten"
          label={t('interface:photo.geometry.angle')}
          value={fine}
          min={-45}
          max={45}
          step={0.1}
          defaultValue={0}
          undoLabel="straighten"
          onValue={(v) => geo('straighten', { rotate: Math.round((step + v) * 100) / 100 })}
        />
        <Button
          testID="photo-straighten-line"
          variant={tool === 'straighten' ? 'primary' : 'secondary'}
          label={t('interface:photo.geometry.drawLine')}
          onPress={() => x.tools.set({ tool: tool === 'straighten' ? 'none' : 'straighten' })}
        />
        {tool === 'straighten' ? (
          <Text className="text-sm text-muted-fg">
            {t('interface:photo.geometry.drawLineHint')}
          </Text>
        ) : null}
      </View>

      <View className="gap-2">
        <Text className="font-semibold">{t('interface:photo.geometry.orientation')}</Text>
        <View className="flex-row flex-wrap gap-2">
          <Button
            testID="photo-rotate-left"
            variant="secondary"
            label={t('interface:photo.geometry.rotateLeft')}
            onPress={() => edit('rotate', (d) => rotateBy(d, -90))}
          />
          <Button
            testID="photo-rotate-right"
            variant="secondary"
            label={t('interface:photo.geometry.rotateRight')}
            onPress={() => edit('rotate', (d) => rotateBy(d, 90))}
          />
          <Button
            testID="photo-rotate-180"
            variant="secondary"
            label={t('interface:photo.geometry.rotate180')}
            onPress={() => edit('rotate', (d) => rotateBy(d, 180))}
          />
        </View>
        <ToggleRow
          label={t('interface:photo.geometry.flipH')}
          value={g.flipH}
          onChange={(v) => geo('flip', { flipH: v })}
        />
        <ToggleRow
          label={t('interface:photo.geometry.flipV')}
          value={g.flipV}
          onChange={(v) => geo('flip', { flipV: v })}
        />
      </View>

      <View className="gap-2">
        <Text className="font-semibold">{t('interface:photo.geometry.perspective')}</Text>
        <View className="flex-row flex-wrap gap-2">
          <Button
            testID="photo-perspective-tool"
            variant={tool === 'perspective' ? 'primary' : 'secondary'}
            label={t('interface:photo.geometry.perspectiveTool')}
            onPress={() => x.tools.set({ tool: tool === 'perspective' ? 'none' : 'perspective' })}
          />
          <Button
            variant="secondary"
            label={t('interface:photo.geometry.resetPerspective')}
            disabled={!g.perspective}
            onPress={() => geo('resetPerspective', { perspective: null })}
          />
        </View>
        <ToggleRow
          label={t('interface:photo.geometry.autoCrop')}
          value={!!g.crop && (g.rotate % 90 !== 0 || !!g.perspective)}
          onChange={autoCrop}
        />
      </View>

      <View className="gap-2">
        <Text className="font-semibold">{t('interface:photo.geometry.fill')}</Text>
        <Chips
          testIDPrefix="photo-fill"
          options={[
            { value: 'transparent', label: t('interface:photo.geometry.fillTransparent') },
            { value: 'edge', label: t('interface:photo.geometry.fillEdge') },
            { value: 'color', label: t('interface:photo.geometry.fillColor') },
          ]}
          value={fillValue}
          onChange={(v) =>
            geo('fill', { fill: v === 'color' ? (fillValue === 'color' ? g.fill : '#000000') : v })
          }
        />
        {fillValue === 'color' ? (
          <Swatches value={g.fill} onChange={(hex) => geo('fill', { fill: hex.toLowerCase() })} />
        ) : null}
      </View>
    </View>
  );
}
