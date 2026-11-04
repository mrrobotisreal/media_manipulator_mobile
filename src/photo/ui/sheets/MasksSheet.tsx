/**
 * Masks (ticket MA51 decisions 2 and 3; web `components/photo/masks/masks-panel.tsx`): pick the
 * adjustment layer, add a "local adjustment" (a layer with an empty mask), arm a touch tool per
 * mask kind (gradient, radial, brush, colour range by tapping the photo), luminosity sliders,
 * "Select subject" (AI, the server route), and per component add / subtract / intersect, feather,
 * remove; per mask feather, strength, invert; the mask view (off / overlay / mask only).
 *
 * Copy reuses the web shard `interface:photo.masks.*`; the phone-only lines are `photo.masks.*`.
 */
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/ui/components/Button';
import { Chips } from '@/ui/components/Chips';
import { Segmented } from '@/ui/components/Segmented';
import { Text } from '@/ui/components/Text';
import { ToggleRow } from '@/ui/components/ToggleRow';
import { BRUSH_SIZE_MAX, BRUSH_SIZE_MIN } from '../../brushEngine';
import {
  addLocalAdjustment,
  clearLayerMask,
  defaultComponent,
  addComponent,
  maskOfLayer,
  removeComponent,
  setMaskProps,
  updateComponent,
  MAX_COLOR_TARGETS,
} from '../../maskOps';
import type { MaskMode } from '../../colorMath';
import type { LayerType, MaskComponent } from '../../photoTypes';
import { useToolState, type MaskView, type ToolId } from '../../tools/toolState';
import { useEdit, useEditor, useEditorTools, usePhotoSelector } from '../EditorContext';
import { ParamSlider } from '../ParamSlider';

const LOCAL_TYPES = ['localBasic', 'exposure', 'tone', 'hsl', 'whiteBalance', 'curves'] as const;
type LocalType = (typeof LOCAL_TYPES)[number];

const KIND_TOOL: Partial<Record<MaskComponent['kind'], ToolId>> = {
  gradient: 'gradient',
  radial: 'radial',
  brush: 'brush',
  colorRange: 'eyedropper',
};

// i18n-keys: photo.masks.hint.gradient, photo.masks.hint.radial, photo.masks.hint.brush, photo.masks.hint.eyedropper, interface:photo.masks.kind.gradient, interface:photo.masks.kind.radial, interface:photo.masks.kind.brush, interface:photo.masks.kind.luminosity, interface:photo.masks.kind.colorRange, interface:photo.masks.kind.subject, interface:photo.masks.mode_add, interface:photo.masks.mode_subtract, interface:photo.masks.mode_intersect, interface:photo.masks.view_off, interface:photo.masks.view_overlay, interface:photo.masks.view_alpha, interface:photo.layers.type.exposure, interface:photo.layers.type.tone, interface:photo.layers.type.hsl, interface:photo.layers.type.whiteBalance, interface:photo.layers.type.curves
export function MasksSheet({
  onMaskAdded,
}: {
  onMaskAdded?: (kind: MaskComponent['kind']) => void;
}) {
  const { t } = useTranslation();
  const { edit } = useEdit();
  const { store } = useEditor();
  const x = useEditorTools();
  const doc = usePhotoSelector((s) => s.doc);
  const selection = usePhotoSelector((s) => s.selection);
  const tool = useToolState(x.tools, (s) => s.tool);
  const view = useToolState(x.tools, (s) => s.maskView);
  const compIdx = useToolState(x.tools, (s) => s.component);
  const brush = useToolState(x.tools, (s) => s.brush);
  const layer = doc?.layers.find((l) => l.id === selection) ?? null;
  const mask = doc && layer ? maskOfLayer(doc, layer.id) : null;
  const comp = mask?.components[compIdx] ?? null;

  const select = (id: string) => store.dispatch({ type: 'photo/selected', payload: id });

  const addLocal = (type: LocalType) => {
    const d = store.getState().doc;
    if (!d) return;
    const r = addLocalAdjustment(d, type as LayerType | 'localBasic');
    edit('addMask', () => r.doc);
    select(r.layerId);
    x.tools.set({ component: 0, tool: 'brush' });
  };

  const addKind = (kind: MaskComponent['kind']) => {
    if (!layer) return;
    if (kind === 'subject') {
      void x.selectSubject?.(layer.id);
      return;
    }
    if (kind === 'luminosity') {
      const before = mask?.components.length ?? 0;
      edit('addMask', (d) => addComponent(d, layer.id, defaultComponent('luminosity')));
      x.tools.set({ component: before, tool: 'none' });
      onMaskAdded?.('luminosity');
      return;
    }
    // Drawn kinds: arm the tool; the component is created by the gesture.
    const toolFor = KIND_TOOL[kind];
    if (toolFor)
      x.tools.set({
        tool: toolFor,
        component: kind === 'brush' ? compIdx : (mask?.components.length ?? 0),
      });
  };

  const layerOptions = (doc?.layers ?? []).map((l) => ({
    value: l.id,
    label: l.name ?? t(`interface:photo.layers.type.${l.type}`),
  }));

  return (
    <View className="gap-4" testID="photo-masks-sheet">
      <View className="gap-2">
        <Text className="font-semibold">{t('interface:photo.masks.localTitle')}</Text>
        <Chips
          testIDPrefix="photo-mask-local"
          options={LOCAL_TYPES.map((v) => ({
            value: v,
            label:
              v === 'localBasic'
                ? t('interface:photo.masks.localBasic')
                : t(`interface:photo.layers.type.${v}`),
          }))}
          value={null}
          onChange={addLocal}
        />
      </View>

      {layerOptions.length > 0 ? (
        <View className="gap-2">
          <Text className="font-semibold">{t('interface:photo.masks.layer')}</Text>
          <Chips
            testIDPrefix="photo-mask-layer"
            options={layerOptions}
            value={selection}
            onChange={(id) => {
              select(id);
              x.tools.set({ component: 0 });
            }}
          />
        </View>
      ) : null}

      {!layer ? (
        <Text className="text-sm text-muted-fg">{t('interface:photo.masks.selectLayer')}</Text>
      ) : (
        <>
          <View className="gap-2">
            <Text className="font-semibold">{t('interface:photo.masks.add')}</Text>
            <Chips
              testIDPrefix="photo-mask-add"
              options={(
                ['gradient', 'radial', 'brush', 'luminosity', 'colorRange', 'subject'] as const
              )
                .filter((k) => k !== 'subject' || x.capabilities?.aiMasks !== false)
                .map((k) => ({
                  value: k,
                  label: t(`interface:photo.masks.kind.${k}`),
                  disabled: k === 'subject' && !!x.subjectBusy,
                }))}
              value={
                tool === 'gradient'
                  ? 'gradient'
                  : tool === 'radial'
                    ? 'radial'
                    : tool === 'brush'
                      ? 'brush'
                      : tool === 'eyedropper'
                        ? 'colorRange'
                        : null
              }
              onChange={addKind}
            />
            {x.subjectBusy ? (
              <Text testID="photo-subject-working" className="text-sm text-data">
                {t('interface:photo.masks.subject.working')}
              </Text>
            ) : null}
            {tool === 'gradient' ||
            tool === 'radial' ||
            tool === 'eyedropper' ||
            tool === 'brush' ? (
              <Text className="text-sm text-muted-fg">{t(`photo.masks.hint.${tool}`)}</Text>
            ) : null}
          </View>

          {tool === 'brush' ? (
            <View className="gap-1" testID="photo-brush-settings">
              <Segmented
                options={[
                  { value: 'paint', label: t('interface:photo.masks.brush.paint') },
                  { value: 'erase', label: t('interface:photo.masks.brush.erase') },
                ]}
                value={brush.erase ? 'erase' : 'paint'}
                onChange={(v) => x.tools.setBrush({ erase: v === 'erase' })}
              />
              <ParamSlider
                testID="photo-brush-size"
                label={t('interface:photo.masks.brush.size')}
                value={brush.size}
                min={BRUSH_SIZE_MIN}
                max={BRUSH_SIZE_MAX}
                defaultValue={60}
                undoLabel="brush"
                onValue={(v) => x.tools.setBrush({ size: v })}
              />
              <ParamSlider
                label={t('interface:photo.masks.brush.hardness')}
                value={brush.hardness}
                min={0}
                max={100}
                defaultValue={50}
                undoLabel="brush"
                onValue={(v) => x.tools.setBrush({ hardness: v })}
              />
              <ParamSlider
                label={t('interface:photo.masks.brush.flow')}
                value={brush.flow}
                min={1}
                max={100}
                defaultValue={100}
                undoLabel="brush"
                onValue={(v) => x.tools.setBrush({ flow: v })}
              />
            </View>
          ) : null}

          {mask && mask.components.length > 0 ? (
            <View className="gap-2">
              <Chips
                testIDPrefix="photo-mask-comp"
                options={mask.components.map((c, i) => ({
                  value: i,
                  label: `${i + 1}. ${t(`interface:photo.masks.kind.${c.kind}`)}`,
                }))}
                value={compIdx}
                onChange={(i) => {
                  const c = mask.components[i];
                  x.tools.set({ component: i, tool: c ? (KIND_TOOL[c.kind] ?? 'none') : 'none' });
                }}
              />
              {comp ? (
                <ComponentEditor
                  layerId={layer.id}
                  index={compIdx}
                  comp={comp}
                  onRemove={() => {
                    edit('removeMaskComponent', (d) => removeComponent(d, layer.id, compIdx));
                    x.tools.set({ component: Math.max(0, compIdx - 1), tool: 'none' });
                  }}
                />
              ) : null}
            </View>
          ) : (
            <Text className="text-sm text-muted-fg">{t('interface:photo.masks.empty')}</Text>
          )}

          {mask ? (
            <View className="gap-1">
              <ParamSlider
                label={t('interface:photo.masks.maskFeather')}
                value={mask.feather}
                min={0}
                max={100}
                defaultValue={0}
                undoLabel="maskFeather"
                onValue={(v) =>
                  edit('maskFeather', (d) => setMaskProps(d, layer.id, { feather: v }))
                }
              />
              <ParamSlider
                label={t('interface:photo.masks.maskOpacity')}
                value={Math.round(mask.opacity * 100)}
                min={0}
                max={100}
                defaultValue={100}
                undoLabel="maskOpacity"
                onValue={(v) =>
                  edit('maskOpacity', (d) => setMaskProps(d, layer.id, { opacity: v / 100 }))
                }
              />
              <ToggleRow
                label={t('interface:photo.masks.invert')}
                value={mask.invert}
                onChange={(v) =>
                  edit('invertMask', (d) => setMaskProps(d, layer.id, { invert: v }))
                }
              />
              <Button
                testID="photo-mask-remove"
                variant="secondary"
                label={t('interface:photo.masks.remove')}
                onPress={() => edit('removeMask', (d) => clearLayerMask(d, layer.id))}
              />
            </View>
          ) : null}

          <View className="gap-2">
            <Text className="font-semibold">{t('interface:photo.masks.view')}</Text>
            <Segmented<MaskView>
              options={(['off', 'overlay', 'alpha'] as const).map((v) => ({
                value: v,
                label: t(`interface:photo.masks.view_${v}`),
              }))}
              value={view}
              onChange={(v) => x.tools.set({ maskView: v })}
            />
          </View>
        </>
      )}
    </View>
  );
}

function ComponentEditor({
  layerId,
  index,
  comp,
  onRemove,
}: {
  layerId: string;
  index: number;
  comp: MaskComponent;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const { edit } = useEdit();
  const patch = (p: Record<string, unknown>) =>
    edit('mask', (d) => updateComponent(d, layerId, index, p as Partial<MaskComponent>));
  return (
    <View className="gap-1" testID="photo-mask-component">
      <Text className="text-sm text-muted-fg">{t('interface:photo.masks.mode')}</Text>
      <Segmented<MaskMode>
        options={(['add', 'subtract', 'intersect'] as const).map((m) => ({
          value: m,
          label: t(`interface:photo.masks.mode_${m}`),
        }))}
        value={comp.mode}
        onChange={(m) => patch({ mode: m })}
      />
      {comp.kind === 'gradient' || comp.kind === 'radial' ? (
        <ParamSlider
          label={t('interface:photo.masks.feather')}
          value={Math.round(comp.feather * 100)}
          min={0}
          max={100}
          defaultValue={comp.kind === 'gradient' ? 0 : 50}
          undoLabel="mask"
          onValue={(v) => patch({ feather: v / 100 })}
        />
      ) : null}
      {comp.kind === 'radial' ? (
        <ParamSlider
          label={t('interface:photo.masks.rotate')}
          value={comp.rotate}
          min={-180}
          max={180}
          defaultValue={0}
          undoLabel="mask"
          onValue={(v) => patch({ rotate: v })}
        />
      ) : null}
      {comp.kind === 'luminosity' ? (
        <>
          <ParamSlider
            label={t('interface:photo.masks.luminosity.lo')}
            value={Math.round(comp.lo * 100)}
            min={0}
            max={100}
            defaultValue={0}
            undoLabel="mask"
            onValue={(v) => patch({ lo: v / 100 })}
          />
          <ParamSlider
            label={t('interface:photo.masks.luminosity.hi')}
            value={Math.round(comp.hi * 100)}
            min={0}
            max={100}
            defaultValue={100}
            undoLabel="mask"
            onValue={(v) => patch({ hi: v / 100 })}
          />
          <ParamSlider
            label={t('interface:photo.masks.feather')}
            value={Math.round(comp.feather * 100)}
            min={0}
            max={100}
            defaultValue={10}
            undoLabel="mask"
            onValue={(v) => patch({ feather: v / 100 })}
          />
        </>
      ) : null}
      {comp.kind === 'colorRange' ? (
        <>
          <Text className="text-sm text-muted-fg">
            {t('photo.masks.colorTargets', { count: comp.colors.length, max: MAX_COLOR_TARGETS })}
          </Text>
          <ParamSlider
            label={t('interface:photo.masks.colorRange.fuzziness')}
            value={comp.fuzziness}
            min={0}
            max={100}
            defaultValue={40}
            undoLabel="mask"
            onValue={(v) => patch({ fuzziness: v })}
          />
        </>
      ) : null}
      {comp.kind === 'subject' ? (
        <ToggleRow
          label={t('interface:photo.masks.subject.invertBackground')}
          value={comp.invert}
          onChange={(v) => patch({ invert: v })}
        />
      ) : null}
      <Button
        testID="photo-mask-comp-remove"
        variant="secondary"
        label={t('interface:photo.masks.removeComponent')}
        onPress={onRemove}
      />
    </View>
  );
}
