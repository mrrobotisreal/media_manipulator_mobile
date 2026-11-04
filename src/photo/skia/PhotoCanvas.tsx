/* eslint-disable react-hooks/immutability -- reanimated shared values are mutated by design (`.value =`). */
/**
 * The Aperture preview (ticket MA50 decision 3). A Skia `Canvas` drawing one recorded picture of
 * the source through the layer shaders (`render.ts`). The picture lives in a Reanimated shared
 * value: a document change (every slider tick) re-records it from a store subscription and assigns
 * `.value`, which Skia redraws without a React render of this tree. Zoom and pan are UI-thread
 * transforms (gesture-handler + reanimated, `view.ts` math).
 *
 * Gestures: pinch to zoom around the fingers, pan when zoomed, double tap Fit <-> 100 %,
 * press-and-hold shows the original ("before"), a two-finger tap toggles before/after. The canvas
 * is always `direction: 'ltr'` (images do not mirror in RTL).
 */
import {
  Canvas,
  Group,
  Picture,
  Skia,
  type SkImage,
  type SkPicture,
} from '@shopify/react-native-skia';
import { useCallback, useEffect, useMemo } from 'react';
import { PixelRatio, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { colors } from '@/ui/tokens';
import {
  computeHistogram64,
  histogramSize,
  HISTOGRAM_INTERVAL_MS,
  type Histogram64,
} from '../histogram';
import type { PhotoDoc } from '../photoTypes';
import { actualScale, clampOffset, doubleTapTarget, fitScale, pinchTo } from '../view';
import { recordDocPicture, renderDocPixels } from './render';

export type CompareGesture = 'hold' | 'toggle';

export interface DocFeed {
  get(): PhotoDoc | null;
  subscribe(listener: () => void): () => void;
}

export interface PhotoCanvasProps {
  image: SkImage;
  /** Preview pixels per original pixel (proxy / downscale < 1); 100 % means original pixels. */
  previewScale: number;
  doc: DocFeed;
  onHistogram?: (h: Histogram64) => void;
  onCompare?: (mode: CompareGesture, showingBefore: boolean) => void;
  testID?: string;
}

const HOLD_MS = 350;

export function PhotoCanvas({
  image,
  previewScale,
  doc,
  onHistogram,
  onCompare,
  testID,
}: PhotoCanvasProps) {
  const imgSize = useMemo(() => ({ width: image.width(), height: image.height() }), [image]);
  const after = useSharedValue<SkPicture | null>(null);
  const before = useSharedValue<SkPicture | null>(null);
  const showBefore = useSharedValue(false);
  const toggled = useSharedValue(false);
  const empty = useMemo(() => {
    const rec = Skia.PictureRecorder();
    rec.beginRecording(Skia.XYWHRect(0, 0, 1, 1));
    return rec.finishRecordingAsPicture();
  }, []);

  const canvasW = useSharedValue(0);
  const canvasH = useSharedValue(0);
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const start = useSharedValue({ scale: 1, x: 0, y: 0 });
  const actual = actualScale(PixelRatio.get(), previewScale);

  // Re-record on every document change; the shared value hands the picture to the UI thread.
  useEffect(() => {
    before.value = recordDocPicture(Skia, image, [], true);
    let last: PhotoDoc | null = null;
    const draw = () => {
      const d = doc.get();
      if (!d || d === last) return;
      last = d;
      after.value = recordDocPicture(Skia, image, d.layers);
    };
    draw();
    return doc.subscribe(draw);
  }, [image, doc, after, before]);

  // Histogram: a 256 px readback of the adjusted image every 300 ms while the doc changes.
  useEffect(() => {
    if (!onHistogram) return;
    const size = histogramSize(imgSize.width, imgSize.height);
    let last: PhotoDoc | null = null;
    const tick = () => {
      const d = doc.get();
      if (!d || d === last) return;
      last = d;
      const px = renderDocPixels(Skia, image, d.layers, size.width, size.height);
      if (px) onHistogram(computeHistogram64(px));
    };
    tick();
    const id = setInterval(tick, HISTOGRAM_INTERVAL_MS);
    return () => clearInterval(id);
  }, [image, doc, imgSize, onHistogram]);

  const fitNow = useCallback(
    (w: number, h: number) => {
      const f = fitScale({ width: w, height: h }, imgSize);
      scale.value = f;
      tx.value = 0;
      ty.value = 0;
    },
    [imgSize, scale, tx, ty],
  );

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    canvasW.value = width;
    canvasH.value = height;
    fitNow(width, height);
  };

  const notifyCompare = useCallback(
    (mode: CompareGesture, on: boolean) => onCompare?.(mode, on),
    [onCompare],
  );
  const twoFingerTap = Gesture.Tap()
    .minPointers(2)
    .maxDuration(250)
    .onEnd(() => {
      toggled.value = !toggled.value;
      showBefore.value = toggled.value;
      scheduleOnRN(notifyCompare, 'toggle', toggled.value);
    });

  const pinch = Gesture.Pinch()
    .onStart(() => {
      start.value = { scale: scale.value, x: tx.value, y: ty.value };
    })
    .onUpdate((e) => {
      const canvas = { width: canvasW.value, height: canvasH.value };
      const f = fitScale(canvas, imgSize);
      const t = pinchTo(
        start.value,
        e.scale,
        { x: e.focalX, y: e.focalY },
        canvas,
        imgSize,
        f,
        actual,
      );
      scale.value = t.scale;
      tx.value = t.x;
      ty.value = t.y;
    });

  const pan = Gesture.Pan()
    .minDistance(4)
    .averageTouches(true)
    .onStart(() => {
      start.value = { scale: scale.value, x: tx.value, y: ty.value };
    })
    .onUpdate((e) => {
      const t = clampOffset(
        {
          scale: scale.value,
          x: start.value.x + e.translationX,
          y: start.value.y + e.translationY,
        },
        { width: canvasW.value, height: canvasH.value },
        imgSize,
      );
      tx.value = t.x;
      ty.value = t.y;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      const canvas = { width: canvasW.value, height: canvasH.value };
      const t = doubleTapTarget(
        { scale: scale.value, x: tx.value, y: ty.value },
        canvas,
        imgSize,
        actual,
        {
          x: e.x,
          y: e.y,
        },
      );
      scale.value = withTiming(t.scale);
      tx.value = withTiming(t.x);
      ty.value = withTiming(t.y);
    });

  const hold = Gesture.LongPress()
    .minDuration(HOLD_MS)
    .maxDistance(12)
    .onStart(() => {
      showBefore.value = true;
      scheduleOnRN(notifyCompare, 'hold', true);
    })
    .onFinalize(() => {
      showBefore.value = toggled.value;
    });

  const gesture = Gesture.Race(
    Gesture.Simultaneous(pinch, pan),
    Gesture.Exclusive(twoFingerTap, doubleTap, hold),
  );

  const transform = useDerivedValue(() => [
    { translateX: canvasW.value / 2 + tx.value - (imgSize.width * scale.value) / 2 },
    { translateY: canvasH.value / 2 + ty.value - (imgSize.height * scale.value) / 2 },
    { scale: scale.value },
  ]);
  const picture = useDerivedValue(() => (showBefore.value ? before.value : after.value) ?? empty);

  return (
    <GestureDetector gesture={gesture}>
      <View
        testID={testID}
        onLayout={onLayout}
        style={{ flex: 1, direction: 'ltr', backgroundColor: colors.surface0 }}
        accessibilityRole="image"
      >
        <Canvas style={{ flex: 1 }}>
          <Group transform={transform}>
            <Picture picture={picture} />
          </Group>
        </Canvas>
      </View>
    </GestureDetector>
  );
}
