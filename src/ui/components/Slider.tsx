/* eslint-disable react-hooks/refs -- gesture callbacks read refs and the player is mutated by design. */
import { useRef, useState } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { colors } from '../tokens';
import { Num, Text } from './Text';

const THUMB = 24;

export const sliderValueAt = (x: number, width: number, min: number, max: number, step: number) => {
  if (!(width > 0)) return min;
  const raw = min + (Math.min(width, Math.max(0, x)) / width) * (max - min);
  const stepped = Math.round((raw - min) / step) * step + min;
  return Math.min(max, Math.max(min, Number(stepped.toFixed(6))));
};

/**
 * Plain gesture slider (no native module). Always laid out left to right; the value is a mono readout.
 * Accessible through `increment` / `decrement` actions.
 */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  onChangeEnd,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  onChangeEnd?: (v: number) => void;
  format?: (v: number) => string;
}) {
  const [width, setWidth] = useState(0);
  const last = useRef(value);
  last.current = value;
  const frac = max > min ? (value - min) / (max - min) : 0;
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onUpdate((e) => onChange(sliderValueAt(e.x, width, min, max, step)))
    .onFinalize(() => onChangeEnd?.(last.current));
  return (
    <View className="gap-1" testID="slider">
      <View className="flex-row justify-between">
        <Text className="text-sm text-muted-fg">{label}</Text>
        <Num className="text-sm" testID="slider-value">
          {format ? format(value) : String(value)}
        </Num>
      </View>
      <GestureDetector gesture={pan}>
        <View
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={label}
          accessibilityValue={{ min, max, now: value }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => {
            const next = Math.min(
              max,
              Math.max(min, value + (e.nativeEvent.actionName === 'increment' ? step : -step)),
            );
            onChange(Number(next.toFixed(6)));
            onChangeEnd?.(Number(next.toFixed(6)));
          }}
          style={{ height: 44, justifyContent: 'center', direction: 'ltr' }}
        >
          <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.surface3 }} />
          <View
            style={{
              position: 'absolute',
              height: 4,
              borderRadius: 2,
              backgroundColor: colors.data,
              width: frac * width,
            }}
          />
          <View
            style={{
              position: 'absolute',
              start: Math.max(0, frac * width - THUMB / 2),
              width: THUMB,
              height: THUMB,
              borderRadius: THUMB / 2,
              backgroundColor: colors.foreground,
            }}
          />
        </View>
      </GestureDetector>
    </View>
  );
}
