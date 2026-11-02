/* eslint-disable react-hooks/immutability -- reanimated shared values are mutated by design. */
import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { Num } from '@/ui/components/Text';
import { colors } from '@/ui/tokens';
import type { PixelRect } from '../options/image';
import {
  applyAspect,
  centredRect,
  containBox,
  displayToSource,
  MIN_SOURCE_PX,
  moveRect,
  resizeCorner,
  sourceToDisplay,
  type Corner,
  type Rect,
} from './cropMath';

const HANDLE = 24;
const HIT = 44;
const CORNERS: Corner[] = ['tl', 'tr', 'bl', 'br'];

export interface CropRectEditorProps {
  uri: string;
  /** EXIF-oriented source size (what the API crops after -auto-orient). */
  sourceWidth: number;
  sourceHeight: number;
  value: PixelRect | null;
  /** width / height, or null for free. */
  aspect: number | null;
  onChange: (rect: PixelRect) => void;
}

/**
 * Native crop rectangle. The rect lives in shared values in display coordinates (origin = image box);
 * gestures work in that space and report integer source pixels on release. The canvas is forced LTR:
 * image coordinates never mirror in he/ar, labels around it still follow the locale.
 */
export function CropRectEditor({
  uri,
  sourceWidth,
  sourceHeight,
  value,
  aspect,
  onChange,
}: CropRectEditorProps) {
  const { t } = useTranslation();
  const [box, setBox] = useState({ x: 0, y: 0, width: 0, height: 0, scale: 1 });
  const [readout, setReadout] = useState<PixelRect | null>(value);
  const rx = useSharedValue(0);
  const ry = useSharedValue(0);
  const rw = useSharedValue(0);
  const rh = useSharedValue(0);
  const bw = useSharedValue(0);
  const bh = useSharedValue(0);
  const scale = useSharedValue(1);
  const aspectSv = useSharedValue<number>(aspect ?? 0);
  const minDisplay = useSharedValue(1);
  // -1 = not seeded yet. Shared values (not refs) so gesture closures stay render-pure.
  const seededAspect = useSharedValue(-1);
  const reportedW = useSharedValue(0);
  const reportedH = useSharedValue(0);
  const reportedX = useSharedValue(0);
  const reportedY = useSharedValue(0);

  const source = { width: sourceWidth, height: sourceHeight };

  const report = useCallback(
    (r: Rect, sc: number) => {
      const px = displayToSource(r, sc, source);
      reportedX.value = px.x;
      reportedY.value = px.y;
      reportedW.value = px.width;
      reportedH.value = px.height;
      setReadout(px);
      onChange(px);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onChange, sourceWidth, sourceHeight],
  );

  const setRect = (r: Rect) => {
    rx.value = r.x;
    ry.value = r.y;
    rw.value = r.width;
    rh.value = r.height;
  };

  const onLayout = (e: LayoutChangeEvent) => {
    const b = containBox(e.nativeEvent.layout, source);
    setBox(b);
    bw.value = b.width;
    bh.value = b.height;
    scale.value = b.scale;
    minDisplay.value = MIN_SOURCE_PX * b.scale;
  };

  // (Re)seed the rect: first layout, aspect change, or an external value (reset).
  useEffect(() => {
    if (box.width <= 0) return;
    const a = aspect ?? null;
    const aspectChanged = seededAspect.value !== -1 && seededAspect.value !== (a ?? 0);
    const external =
      !!value &&
      (value.x !== reportedX.value ||
        value.y !== reportedY.value ||
        value.width !== reportedW.value ||
        value.height !== reportedH.value);
    seededAspect.value = a ?? 0;
    aspectSv.value = a ?? 0;
    let next: Rect;
    if (value && !aspectChanged) {
      next = sourceToDisplay(value, box.scale);
      if (!external && rw.value > 0) return;
    } else if (value && aspectChanged) {
      next = applyAspect(
        sourceToDisplay(value, box.scale),
        a,
        { width: box.width, height: box.height },
        MIN_SOURCE_PX * box.scale,
      );
    } else {
      next = sourceToDisplay(centredRect(source, a), box.scale);
    }
    setRect(next);
    // Seeding the default rect must tell the form once (external sync of the native overlay).
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!value || aspectChanged) report(next, box.scale);
    else setReadout(value);
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box, aspect, value]);

  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startW = useSharedValue(0);
  const startH = useSharedValue(0);
  const remember = () => {
    'worklet';
    startX.value = rx.value;
    startY.value = ry.value;
    startW.value = rw.value;
    startH.value = rh.value;
  };
  const apply = (r: Rect) => {
    'worklet';
    rx.value = r.x;
    ry.value = r.y;
    rw.value = r.width;
    rh.value = r.height;
  };
  const finish = () => {
    'worklet';
    runOnJS(report)({ x: rx.value, y: ry.value, width: rw.value, height: rh.value }, scale.value);
  };

  const move = Gesture.Pan()
    .onBegin(remember)
    .onUpdate((e) => {
      apply(
        moveRect(
          { x: startX.value, y: startY.value, width: startW.value, height: startH.value },
          e.translationX,
          e.translationY,
          { width: bw.value, height: bh.value },
        ),
      );
    })
    .onEnd(finish);

  const cornerGesture = (corner: Corner) =>
    Gesture.Pan()
      .onBegin(remember)
      .onUpdate((e) => {
        apply(
          resizeCorner(
            { x: startX.value, y: startY.value, width: startW.value, height: startH.value },
            corner,
            e.translationX,
            e.translationY,
            { width: bw.value, height: bh.value },
            minDisplay.value,
            aspectSv.value > 0 ? aspectSv.value : null,
          ),
        );
      })
      .onEnd(finish);

  const frame = useAnimatedStyle(() => ({
    left: rx.value,
    top: ry.value,
    width: rw.value,
    height: rh.value,
  }));
  const dimTop = useAnimatedStyle(() => ({ left: 0, top: 0, right: 0, height: ry.value }));
  const dimBottom = useAnimatedStyle(() => ({
    left: 0,
    right: 0,
    top: ry.value + rh.value,
    bottom: 0,
  }));
  const dimLeft = useAnimatedStyle(() => ({
    left: 0,
    top: ry.value,
    width: rx.value,
    height: rh.value,
  }));
  const dimRight = useAnimatedStyle(() => ({
    left: rx.value + rw.value,
    right: 0,
    top: ry.value,
    height: rh.value,
  }));
  const handleStyle = (corner: Corner) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks -- fixed corner order
    useAnimatedStyle(() => ({
      left: (corner === 'tl' || corner === 'bl' ? rx.value : rx.value + rw.value) - HIT / 2,
      top: (corner === 'tl' || corner === 'tr' ? ry.value : ry.value + rh.value) - HIT / 2,
    }));
  const handles = {
    tl: handleStyle('tl'),
    tr: handleStyle('tr'),
    bl: handleStyle('bl'),
    br: handleStyle('br'),
  };
  const dim = { position: 'absolute', backgroundColor: `${colors.surface0}99` } as const;

  return (
    <View className="gap-2">
      <View
        testID="crop-canvas"
        onLayout={onLayout}
        style={{ direction: 'ltr', width: '100%', aspectRatio: sourceWidth / sourceHeight }}
      >
        <Image source={{ uri }} contentFit="contain" style={{ width: '100%', height: '100%' }} />
        {box.width > 0 ? (
          <View
            pointerEvents="box-none"
            style={{
              position: 'absolute',
              left: box.x,
              top: box.y,
              width: box.width,
              height: box.height,
            }}
          >
            <Animated.View pointerEvents="none" style={[dim, dimTop]} />
            <Animated.View pointerEvents="none" style={[dim, dimBottom]} />
            <Animated.View pointerEvents="none" style={[dim, dimLeft]} />
            <Animated.View pointerEvents="none" style={[dim, dimRight]} />
            <GestureDetector gesture={move}>
              <Animated.View
                testID="crop-frame"
                style={[
                  { position: 'absolute', borderWidth: 2, borderColor: colors.primary },
                  frame,
                ]}
              />
            </GestureDetector>
            {CORNERS.map((c) => (
              <GestureDetector key={c} gesture={cornerGesture(c)}>
                <Animated.View
                  testID={`crop-handle-${c}`}
                  accessible
                  accessibilityRole="adjustable"
                  accessibilityLabel={t('toolUi.crop.a11yHandle', { corner: c.toUpperCase() })}
                  style={[
                    {
                      position: 'absolute',
                      width: HIT,
                      height: HIT,
                      alignItems: 'center',
                      justifyContent: 'center',
                    },
                    handles[c],
                  ]}
                >
                  <View
                    style={{
                      width: HANDLE,
                      height: HANDLE,
                      borderRadius: HANDLE / 2,
                      backgroundColor: colors.primary,
                    }}
                  />
                </Animated.View>
              </GestureDetector>
            ))}
          </View>
        ) : null}
      </View>
      {readout ? (
        <Num className="text-center text-sm text-muted-fg" testID="crop-readout">
          {t('toolUi.crop.size', { width: readout.width, height: readout.height })}
        </Num>
      ) : null}
    </View>
  );
}
