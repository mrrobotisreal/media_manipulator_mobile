/* eslint-disable react-hooks/refs -- gesture callbacks run on touch events, never during render; they read the drag state through refs by design. */
/**
 * One adjustment slider (ticket MA50 decision 7): MA17's `Slider` with a numeric readout, the
 * whole drag recorded as ONE undo step, double-tap resets to the default, a light haptic tick when
 * the value crosses the default.
 */
import * as Haptics from 'expo-haptics';
import { useRef } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { View } from 'react-native';
import { Slider } from '@/ui/components/Slider';
import { useEdit, useEditor } from './EditorContext';

export function ParamSlider({
  label,
  value,
  min,
  max,
  step = 1,
  defaultValue = 0,
  onValue,
  undoLabel,
  format,
  testID,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  /** Applies the value to the doc (one `edit` call). */
  onValue: (v: number) => void;
  undoLabel: string;
  format?: (v: number) => string;
  testID?: string;
}) {
  const { begin, end } = useEdit();
  const { haptics = true } = useEditor();
  const last = useRef(value);
  const set = (v: number) => {
    const crossed = (last.current - defaultValue) * (v - defaultValue) <= 0 && v !== last.current;
    last.current = v;
    if (crossed && v === defaultValue && haptics)
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onValue(v);
  };
  const reset = Gesture.Tap()
    .numberOfTaps(2)
    .runOnJS(true)
    .onEnd(() => {
      if (value === defaultValue) return;
      begin(undoLabel);
      set(defaultValue);
      end();
    });
  const fmt =
    format ?? ((v: number) => (step < 1 ? v.toFixed(step < 0.1 ? 2 : 1) : String(Math.round(v))));
  return (
    <GestureDetector gesture={reset}>
      <View>
        <Slider
          label={label}
          value={value}
          min={min}
          max={max}
          step={step}
          format={fmt}
          onChange={set}
          onStart={() => begin(undoLabel)}
          onEnd={end}
          testID={testID}
        />
      </View>
    </GestureDetector>
  );
}
