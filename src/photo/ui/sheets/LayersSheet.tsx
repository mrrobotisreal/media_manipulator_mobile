/* eslint-disable react-hooks/refs -- gesture callbacks run on touch events, never during render; they read the drag state through refs by design. */
/**
 * Layers (design §5.1): the stack top first; per layer enable, opacity, blend, duplicate, delete;
 * reorder by long-press then drag (row height steps), with Move up / Move down for screen readers.
 */
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Button } from '@/ui/components/Button';
import { Chips } from '@/ui/components/Chips';
import { Text } from '@/ui/components/Text';
import { ToggleRow } from '@/ui/components/ToggleRow';
import { reorderFromList } from '../../edits';
import { duplicateLayer, moveLayer, patchLayer, removeLayer } from '../../layerOps';
import type { AdjustmentLayer, BlendMode } from '../../photoTypes';
import { useEdit, usePhotoSelector } from '../EditorContext';
import { ParamSlider } from '../ParamSlider';

const ROW = 56;

/** Where a row dragged by `dy` points lands in the list (clamped). */
export const dropIndex = (from: number, dy: number, count: number) =>
  Math.max(0, Math.min(count - 1, from + Math.round(dy / ROW)));

function LayerRow({
  layer,
  listIndex,
  count,
}: {
  layer: AdjustmentLayer;
  listIndex: number;
  count: number;
}) {
  const { t } = useTranslation();
  const { edit } = useEdit();
  const [open, setOpen] = useState(false);
  const [dy, setDy] = useState(0);
  const dragging = useRef(false);
  const name = layer.name ?? t(`interface:photo.layers.type.${layer.type}`);

  const drag = Gesture.Pan()
    .runOnJS(true)
    .activateAfterLongPress(300)
    .onStart(() => {
      dragging.current = true;
    })
    .onUpdate((e) => setDy(e.translationY))
    .onEnd((e) => {
      const to = dropIndex(listIndex, e.translationY, count);
      if (to !== listIndex) edit('reorder', (d) => reorderFromList(d, layer.id, to));
    })
    .onFinalize(() => {
      dragging.current = false;
      setDy(0);
    });

  const blends: { value: BlendMode; label: string }[] = (
    ['normal', 'luminosity', 'color'] as const
  ).map((value) => ({
    value,
    label: t(`interface:photo.layers.blendMode.${value}`),
  }));

  return (
    <View
      testID={`photo-layer-${layer.id}`}
      style={{ transform: [{ translateY: dy }], zIndex: dy ? 1 : 0 }}
      className="border-b border-edge"
    >
      <GestureDetector gesture={drag}>
        <Pressable
          accessibilityRole="button"
          accessibilityHint={t('photo.layers.reorder')}
          accessibilityActions={[
            { name: 'moveUp', label: t('interface:photo.layers.moveUp') },
            { name: 'moveDown', label: t('interface:photo.layers.moveDown') },
          ]}
          onAccessibilityAction={(e) => {
            const to = listIndex + (e.nativeEvent.actionName === 'moveUp' ? -1 : 1);
            if (to >= 0 && to < count) edit('reorder', (d) => reorderFromList(d, layer.id, to));
          }}
          onPress={() => setOpen((o) => !o)}
          className="flex-row items-center gap-3"
          style={{ minHeight: ROW }}
        >
          <Text className={`flex-1 ${layer.enabled ? '' : 'text-subtle'}`}>{name}</Text>
          <Text className="text-sm text-subtle">{`${Math.round(layer.opacity * 100)} %`}</Text>
        </Pressable>
      </GestureDetector>
      {open ? (
        <View className="gap-2 pb-3">
          <ToggleRow
            label={t('interface:photo.layers.enable')}
            value={layer.enabled}
            onChange={(enabled) => edit('layer', (d) => patchLayer(d, layer.id, { enabled }))}
          />
          <ParamSlider
            label={t('interface:photo.layers.opacity')}
            value={Math.round(layer.opacity * 100)}
            min={0}
            max={100}
            defaultValue={100}
            undoLabel="opacity"
            format={(v) => `${v} %`}
            onValue={(v) => edit('opacity', (d) => patchLayer(d, layer.id, { opacity: v / 100 }))}
          />
          <Text className="text-sm text-muted-fg">{t('interface:photo.layers.blend')}</Text>
          <Chips
            options={blends}
            value={layer.blend}
            onChange={(blend) => edit('blend', (d) => patchLayer(d, layer.id, { blend }))}
          />
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Button
                variant="secondary"
                label={t('interface:photo.layers.duplicate')}
                onPress={() => edit('duplicate', (d) => duplicateLayer(d, layer.id).doc)}
              />
            </View>
            <View className="flex-1">
              <Button
                variant="danger"
                testID={`photo-layer-delete-${layer.id}`}
                label={t('interface:photo.layers.delete')}
                onPress={() => edit('delete', (d) => removeLayer(d, layer.id))}
              />
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function LayersSheet() {
  const { t } = useTranslation();
  const doc = usePhotoSelector((s) => s.doc);
  const layers = doc ? [...doc.layers].reverse() : [];
  if (layers.length === 0)
    return <Text className="text-muted-fg">{t('interface:photo.layers.empty')}</Text>;
  return (
    <View>
      {layers.map((l, i) => (
        <LayerRow key={l.id} layer={l} listIndex={i} count={layers.length} />
      ))}
    </View>
  );
}

export { moveLayer };
