import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Button } from '@/ui/components/Button';
import { Num, Text } from '@/ui/components/Text';
import { colors } from '@/ui/tokens';
import type { ObjectRect } from '../options/ai';
import {
  MIN_SIZE,
  clampRect,
  cornerAt,
  displayToNorm,
  moveRect,
  normToDisplay,
  rectAt,
  rectFromPoints,
  resizeFromCorner,
  type Corner,
  type Rect,
} from './overlayMath';

export interface RectDrawerProps {
  uri: string;
  /** Width / height of the ORIENTED image (what the server measures). */
  aspect: number;
  rects: ObjectRect[];
  onChange: (rects: ObjectRect[]) => void;
  maxRects?: number;
  newId?: () => string;
}

type Interaction =
  | { kind: 'draw'; id: string; origin: { x: number; y: number } }
  | { kind: 'move'; id: string; origin: { x: number; y: number }; start: Rect; moved: boolean }
  | {
      kind: 'resize';
      id: string;
      corner: Corner;
      origin: { x: number; y: number };
      start: Rect;
    };

const HANDLE = 14;
let seq = 0;
const defaultId = () => `r${(seq += 1)}`;

/**
 * Object-rectangle drawer for `remove-object`. One pan gesture covers draw / move / resize (JS thread;
 * no reanimated): a drag on empty space draws a box, inside a box moves it, on a selected box's corner
 * resizes it, a tap selects. Coordinates are normalized to the displayed oriented image; the canvas is
 * forced LTR so boxes never mirror in he/ar.
 */
export function RectDrawer({
  uri,
  aspect,
  rects,
  onChange,
  maxRects = 10,
  newId = defaultId,
}: RectDrawerProps) {
  const { t } = useTranslation();
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const [selected, setSelected] = useState<string | null>(null);
  const active = useRef<Interaction | null>(null);
  // Gesture callbacks outlive a render; they must always see the latest boxes.
  const latest = useRef(rects);
  useEffect(() => {
    latest.current = rects;
  }, [rects]);

  const commit = (next: ObjectRect[]) => {
    latest.current = next;
    onChange(next);
  };
  const norm = (p: { x: number; y: number }) => displayToNorm(p, layout, aspect);
  const replace = (id: string, rect: Rect) =>
    commit(latest.current.map((r) => (r.id === id ? { ...r, ...rect } : r)));

  const gesture = Gesture.Pan()
    .withTestId('rect-pan')
    .minDistance(0)
    .runOnJS(true)
    .onBegin((e) => {
      const point = { x: e.x, y: e.y };
      const n = norm(point);
      const rects = latest.current;
      const sel = rects.find((r) => r.id === selected);
      if (sel) {
        const corner = cornerAt(sel, point, layout, aspect);
        if (corner) {
          active.current = { kind: 'resize', id: sel.id, corner, origin: n, start: sel };
          return;
        }
      }
      const hit = rectAt(rects, n);
      if (hit >= 0) {
        const r = rects[hit]!;
        setSelected(r.id);
        active.current = { kind: 'move', id: r.id, origin: n, start: r, moved: false };
        return;
      }
      if (rects.length >= maxRects) {
        active.current = null;
        return;
      }
      active.current = { kind: 'draw', id: newId(), origin: n };
    })
    .onUpdate((e) => {
      const a = active.current;
      if (!a) return;
      const n = norm({ x: e.x, y: e.y });
      if (a.kind === 'draw') {
        const r = rectFromPoints(a.origin, n);
        const next = { id: a.id, ...r };
        const cur = latest.current;
        commit(
          cur.some((x) => x.id === a.id)
            ? cur.map((x) => (x.id === a.id ? next : x))
            : [...cur, next],
        );
        setSelected(a.id);
      } else if (a.kind === 'move') {
        a.moved = true;
        replace(a.id, moveRect(a.start, n.x - a.origin.x, n.y - a.origin.y));
      } else {
        replace(a.id, resizeFromCorner(a.start, a.corner, n.x - a.origin.x, n.y - a.origin.y));
      }
    })
    .onFinalize(() => {
      const a = active.current;
      active.current = null;
      if (a?.kind === 'draw') {
        const drawn = latest.current.find((r) => r.id === a.id);
        // Too small to be deliberate (a tap): drop it.
        if (drawn && (drawn.width < MIN_SIZE || drawn.height < MIN_SIZE)) {
          commit(latest.current.filter((r) => r.id !== a.id));
          setSelected(null);
        } else if (drawn) {
          replace(a.id, clampRect(drawn));
        }
      }
    });

  const onLayout = (e: LayoutChangeEvent) =>
    setLayout({
      width: e.nativeEvent.layout.width,
      height: e.nativeEvent.layout.height,
    });

  return (
    <View className="gap-3">
      <Text className="text-sm text-muted-fg">{t('tools.ai.rects.hint')}</Text>
      <GestureDetector gesture={gesture}>
        <View
          testID="rect-canvas"
          onLayout={onLayout}
          accessibilityLabel={t('tools.ai.rects.hint')}
          className="w-full overflow-hidden rounded-lg border border-edge bg-surface-0"
          style={{ aspectRatio: Math.min(2, Math.max(0.5, aspect)), direction: 'ltr' }}
        >
          <Image
            source={{ uri }}
            style={{ width: '100%', height: '100%' }}
            contentFit="contain"
            pointerEvents="none"
          />
          {rects.map((r) => {
            const d = normToDisplay(r, layout, aspect);
            const isSel = r.id === selected;
            return (
              <View
                key={r.id}
                testID={`rect-${r.id}`}
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: d.left,
                  top: d.top,
                  width: d.width,
                  height: d.height,
                  borderWidth: 2,
                  borderColor: isSel ? colors.primary : colors.data,
                  backgroundColor: isSel ? 'rgba(255,107,74,0.18)' : 'rgba(94,234,212,0.14)',
                }}
              >
                {isSel
                  ? (['nw', 'ne', 'sw', 'se'] as Corner[]).map((c) => (
                      <View
                        key={c}
                        style={{
                          position: 'absolute',
                          width: HANDLE,
                          height: HANDLE,
                          backgroundColor: colors.primary,
                          borderRadius: 2,
                          left: c === 'nw' || c === 'sw' ? -HANDLE / 2 : undefined,
                          right: c === 'ne' || c === 'se' ? -HANDLE / 2 : undefined,
                          top: c === 'nw' || c === 'ne' ? -HANDLE / 2 : undefined,
                          bottom: c === 'sw' || c === 'se' ? -HANDLE / 2 : undefined,
                        }}
                      />
                    ))
                  : null}
              </View>
            );
          })}
        </View>
      </GestureDetector>
      <View className="flex-row flex-wrap items-center gap-2">
        <Num className="text-sm text-muted-fg" testID="rect-count">
          {t('tools.ai.rects.count', { count: rects.length })}
        </Num>
        <View className="flex-1" />
        <Button
          variant="secondary"
          label={t('tools.ai.rects.delete')}
          disabled={!selected}
          onPress={() => {
            onChange(rects.filter((r) => r.id !== selected));
            setSelected(null);
          }}
        />
        <Button
          variant="secondary"
          label={t('tools.ai.rects.clearAll')}
          disabled={rects.length === 0}
          onPress={() => {
            onChange([]);
            setSelected(null);
          }}
        />
      </View>
    </View>
  );
}
