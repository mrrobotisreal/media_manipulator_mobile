/* eslint-disable react-hooks/immutability -- reanimated shared values are mutated by design (`.value =`). */
import type { ReactNode } from 'react';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

export interface ZoomState {
  scale: SharedValue<number>;
  x: SharedValue<number>;
  y: SharedValue<number>;
}

/** One transform shared by every layer that must zoom together (the compare modes). */
export function useZoomState(): ZoomState {
  return { scale: useSharedValue(1), x: useSharedValue(0), y: useSharedValue(0) };
}

const MAX_SCALE = 6;
const DOUBLE_TAP_SCALE = 2.5;

/**
 * Pinch + pan + double-tap zoom on gesture-handler and reanimated (no zoom library). `onTap` fires on
 * a confirmed single tap (the toggle compare uses it). Pan only moves a zoomed layer, so a parent
 * scroll view keeps working at 1x.
 */
export function ZoomContainer({
  zoom,
  children,
  onTap,
  style,
}: {
  zoom: ZoomState;
  children: ReactNode;
  onTap?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { scale, x, y } = zoom;
  const w = useSharedValue(0);
  const h = useSharedValue(0);
  const savedScale = useSharedValue(1);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    w.value = width;
    h.value = height;
  };

  const pinch = Gesture.Pinch()
    .onStart(() => {
      savedScale.value = scale.value;
    })
    .onUpdate((e) => {
      scale.value = Math.min(MAX_SCALE, Math.max(1, savedScale.value * e.scale));
    })
    .onEnd(() => {
      if (scale.value < 1.02) {
        scale.value = withTiming(1);
        x.value = withTiming(0);
        y.value = withTiming(0);
      }
    });

  const pan = Gesture.Pan()
    .minDistance(4)
    .onStart(() => {
      savedX.value = x.value;
      savedY.value = y.value;
    })
    .onUpdate((e) => {
      if (scale.value <= 1) return;
      const maxX = (w.value * (scale.value - 1)) / 2;
      const maxY = (h.value * (scale.value - 1)) / 2;
      x.value = Math.min(maxX, Math.max(-maxX, savedX.value + e.translationX));
      y.value = Math.min(maxY, Math.max(-maxY, savedY.value + e.translationY));
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((_e, ok) => {
      if (!ok) return;
      const zoomed = scale.value > 1.05;
      scale.value = withTiming(zoomed ? 1 : DOUBLE_TAP_SCALE);
      x.value = withTiming(0);
      y.value = withTiming(0);
    });

  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .onEnd((_e, ok) => {
      if (ok && onTap) onTap();
    })
    .runOnJS(true);

  const composed = Gesture.Race(
    Gesture.Simultaneous(pinch, pan),
    Gesture.Exclusive(doubleTap, singleTap),
  );

  const animated = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={composed}>
      <Animated.View
        testID="zoom-container"
        onLayout={onLayout}
        style={[{ overflow: 'hidden' }, style]}
      >
        <Animated.View style={[{ width: '100%', height: '100%' }, animated]}>
          {children}
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}
