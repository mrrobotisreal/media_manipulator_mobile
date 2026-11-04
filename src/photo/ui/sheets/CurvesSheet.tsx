/* eslint-disable react-hooks/refs -- gesture callbacks run on touch events, never during render; they read the drag state through refs by design. */
/**
 * Curves (design §5.1): per-channel segmented control, the curve drawn on a Skia `Path` (the same
 * monotone cubic as `colorMath.buildCurveLut`), points dragged with a finger. A drag past a
 * neighbour is refused (`dragCurvePoint` clamps it short; a notice says so once per drag). Tap the
 * graph to add a point. The graph is always `direction: 'ltr'` (input on x, left = black).
 */
import { Canvas, Circle, Path, Skia } from '@shopify/react-native-skia';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Button } from '@/ui/components/Button';
import { Segmented } from '@/ui/components/Segmented';
import { Text } from '@/ui/components/Text';
import { colors } from '@/ui/tokens';
import { buildCurveLut } from '../../colorMath';
import {
  addCurvePoint,
  curvePoints,
  dragCurvePoint,
  resetCurve,
  type CurveChannel,
} from '../../edits';
import { useEdit, usePhotoSelector } from '../EditorContext';

const HIT = 28;
const STROKE: Record<CurveChannel, string> = {
  master: colors.foreground,
  r: '#F4525C',
  g: '#4ADE80',
  b: '#5EA8FF',
};

/** Nearest point within the hit radius, in graph pixels; -1 when none. */
export function hitPoint(
  points: { x: number; y: number }[],
  px: number,
  py: number,
  size: number,
): number {
  let best = -1;
  let bestD = HIT;
  points.forEach((p, i) => {
    const d = Math.hypot(p.x * size - px, (1 - p.y) * size - py);
    if (d < bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

export function CurvesSheet({ onRefused }: { onRefused?: () => void }) {
  const { t } = useTranslation();
  const doc = usePhotoSelector((s) => s.doc);
  const { edit, begin, end } = useEdit();
  const [ch, setCh] = useState<CurveChannel>('master');
  const [size, setSize] = useState(0);
  const dragging = useRef(-1);
  const refusedOnce = useRef(false);
  const points = curvePoints(doc, ch);

  const path = useMemo(() => {
    const p = Skia.Path.Make();
    if (size <= 0) return p;
    const lut = buildCurveLut(points);
    lut.forEach((v, i) => {
      const x = (i / 255) * size;
      const y = (1 - v) * size;
      if (i === 0) p.moveTo(x, y);
      else p.lineTo(x, y);
    });
    return p;
  }, [points, size]);

  const toUnit = (x: number, y: number) => ({
    x: Math.min(1, Math.max(0, x / size)),
    y: Math.min(1, Math.max(0, 1 - y / size)),
  });

  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((e) => {
      if (size <= 0 || !doc) return;
      let i = hitPoint(points, e.x, e.y, size);
      begin('curves');
      refusedOnce.current = false;
      if (i < 0) {
        const u = toUnit(e.x, e.y);
        let added = -1;
        edit(
          'curves',
          (d) => {
            const r = addCurvePoint(d, ch, u.x, u.y);
            added = r.index;
            return r.doc;
          },
          ['curves', ch],
        );
        i = added;
      }
      dragging.current = i;
    })
    .onUpdate((e) => {
      const i = dragging.current;
      if (i < 0) return;
      const u = toUnit(e.x, e.y);
      edit(
        'curves',
        (d) => {
          const r = dragCurvePoint(d, ch, i, u.x, u.y);
          if (r.refused && !refusedOnce.current) {
            refusedOnce.current = true;
            onRefused?.();
          }
          return r.doc;
        },
        ['curves', ch],
      );
    })
    .onFinalize(() => {
      dragging.current = -1;
      end();
    });

  const options = (['master', 'r', 'g', 'b'] as const).map((value) => ({
    value,
    label: t(`interface:photo.curves.channel.${value}`),
  }));
  return (
    <View className="gap-3">
      <Segmented options={options} value={ch} onChange={setCh} />
      <GestureDetector gesture={pan}>
        <View
          testID="photo-curves-graph"
          accessibilityLabel={t('interface:photo.curves.graph')}
          onLayout={(e: LayoutChangeEvent) => setSize(Math.min(e.nativeEvent.layout.width, 320))}
          style={{
            direction: 'ltr',
            aspectRatio: 1,
            width: '100%',
            maxWidth: 320,
            alignSelf: 'center',
          }}
        >
          <Canvas style={{ flex: 1, backgroundColor: colors.surface2 }}>
            <Path
              path={Skia.Path.MakeFromSVGString(`M0 ${size} L${size} 0`) ?? Skia.Path.Make()}
              color={colors.edge}
              style="stroke"
              strokeWidth={1}
            />
            <Path path={path} color={STROKE[ch]} style="stroke" strokeWidth={2} />
            {points.map((p, i) => (
              <Circle key={i} cx={p.x * size} cy={(1 - p.y) * size} r={7} color={STROKE[ch]} />
            ))}
          </Canvas>
        </View>
      </GestureDetector>
      <Text className="text-sm text-subtle">{t('photo.curves.hint')}</Text>
      <Button
        variant="ghost"
        label={t('interface:photo.curves.reset')}
        onPress={() => edit('curves', (d) => resetCurve(d, ch))}
      />
    </View>
  );
}
