import { useState } from 'react';
import { I18nManager, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Num, Text } from './Text';

export function snapToStep(raw: number, min: number, max: number, step: number): number {
  const snapped = Math.round((raw - min) / step) * step + min;
  return Math.min(max, Math.max(min, snapped));
}

/**
 * Horizontal slider on gesture-handler (no native module). The track follows the layout direction:
 * min sits at the start edge in LTR and RTL. Also an accessibility "adjustable" (increment/decrement).
 */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  const [width, setWidth] = useState(0);
  const rtl = I18nManager.isRTL;
  const fraction = max === min ? 0 : (value - min) / (max - min);
  const thumb = 24;

  const setFromX = (x: number) => {
    if (width <= 0) return;
    const f = Math.min(1, Math.max(0, x / width));
    const ratio = rtl ? 1 - f : f;
    const next = snapToStep(min + ratio * (max - min), min, max, step);
    if (next !== value) onChange(next);
  };
  // runOnJS(true): callbacks run on the JS thread, so no reanimated/worklets import is needed.
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((e) => setFromX(e.x))
    .onUpdate((e) => setFromX(e.x));

  return (
    <View className="gap-1">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm text-muted-fg">{label}</Text>
        <Num className="text-sm">{format ? format(value) : String(value)}</Num>
      </View>
      <GestureDetector gesture={pan}>
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={label}
          accessibilityValue={{ min, max, now: value, text: format ? format(value) : undefined }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => {
            const dir = e.nativeEvent.actionName === 'increment' ? 1 : -1;
            onChange(snapToStep(value + dir * step, min, max, step));
          }}
          onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
          style={{ height: 44, justifyContent: 'center' }}
        >
          <View className="h-1 rounded-full bg-surface-3">
            <View className="h-1 rounded-full bg-primary" style={{ width: `${fraction * 100}%` }} />
          </View>
          <View
            pointerEvents="none"
            className="absolute rounded-full bg-primary"
            style={{
              width: thumb,
              height: thumb,
              top: 10,
              start: Math.max(0, fraction * (width - thumb)),
            }}
          />
        </View>
      </GestureDetector>
    </View>
  );
}
