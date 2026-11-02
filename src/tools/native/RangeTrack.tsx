/* eslint-disable react-hooks/refs -- the gesture callbacks run on events, not during render */
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { colors } from '@/ui/tokens';
import { clampRange, DEFAULT_MIN_GAP, timeToX, xToTime } from './rangeMath';

export interface RangeTrackProps {
  duration: number;
  start: number;
  end: number;
  minGap?: number;
  playhead?: number;
  onChange: (start: number, end: number) => void;
  onScrubStart?: () => void;
  onScrub?: (t: number) => void;
  /** Rendered behind the window (placeholder strip, thumbnails). */
  background?: ReactNode;
}

const HANDLE = 14;
const HEIGHT = 56;
const SLOP = 15; // (44 - HANDLE) / 2 on each side

/**
 * Two-handle range over [0, duration]. Time always runs left to right (forced LTR, also in RTL
 * locales), so physical offsets are used deliberately inside this component.
 */
export function RangeTrack({
  duration,
  start,
  end,
  minGap = DEFAULT_MIN_GAP,
  playhead,
  onChange,
  onScrubStart,
  onScrub,
  background,
}: RangeTrackProps) {
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<{ start: number; end: number } | null>(null);

  const [dragRef] = useState<{ current: { start: number; end: number } | null }>(() => ({
    current: null,
  }));
  const cur = drag ?? { start, end };
  const x0 = timeToX(cur.start, duration, width);
  const x1 = timeToX(cur.end, duration, width);

  const make = (which: 'start' | 'end' | 'window') => {
    let base = { start, end };
    return Gesture.Pan()
      .minDistance(0)
      .onBegin(() => {
        base = { start: cur.start, end: cur.end };
        onScrubStart?.();
      })
      .onUpdate((e) => {
        const dt = xToTime(Math.abs(e.translationX), duration, width) * Math.sign(e.translationX);
        let next;
        if (which === 'start')
          next = clampRange(base.start + dt, base.end, duration, minGap, 'start');
        else if (which === 'end')
          next = clampRange(base.start, base.end + dt, duration, minGap, 'end');
        else {
          const len = base.end - base.start;
          const s = Math.min(duration - len, Math.max(0, base.start + dt));
          next = clampRange(s, s + len, duration, minGap, 'start');
        }
        dragRef.current = next;
        setDrag(next);
        onScrub?.(which === 'end' ? next.end : next.start);
      })
      .onEnd(() => {
        // Parent state follows onChange; drop the local drag on the same tick.
        if (dragRef.current) onChange(dragRef.current.start, dragRef.current.end);
        dragRef.current = null;
        setDrag(null);
      })
      .runOnJS(true);
  };

  const ph = playhead !== undefined ? timeToX(playhead, duration, width) : null;

  return (
    <View
      testID="range-track"
      style={{ direction: 'ltr', height: HEIGHT }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      className="justify-center"
    >
      <View
        className="absolute inset-y-0 overflow-hidden rounded-md border border-edge bg-surface-2"
        style={{ start: 0, end: 0 }}
      >
        {background}
      </View>
      <GestureDetector gesture={make('window')}>
        <View
          testID="range-window"
          accessibilityRole="adjustable"
          className="absolute inset-y-0 border-y-2 border-data bg-data/15"
          style={{ left: x0, width: Math.max(0, x1 - x0) }}
        />
      </GestureDetector>
      {ph !== null ? (
        <View
          pointerEvents="none"
          className="absolute inset-y-0 w-0.5 bg-foreground"
          style={{ left: ph }}
        />
      ) : null}
      <GestureDetector gesture={make('start')}>
        <View
          testID="range-handle-start"
          accessibilityRole="adjustable"
          className="absolute inset-y-0 items-center justify-center rounded-sm bg-data"
          style={{ left: x0 - HANDLE / 2, width: HANDLE }}
          hitSlop={{ left: SLOP, right: SLOP, top: 8, bottom: 8 }}
        >
          <View className="h-6 w-0.5 rounded-full" style={{ backgroundColor: colors.onData }} />
        </View>
      </GestureDetector>
      <GestureDetector gesture={make('end')}>
        <View
          testID="range-handle-end"
          accessibilityRole="adjustable"
          className="absolute inset-y-0 items-center justify-center rounded-sm bg-data"
          style={{ left: x1 - HANDLE / 2, width: HANDLE }}
          hitSlop={{ left: SLOP, right: SLOP, top: 8, bottom: 8 }}
        >
          <View className="h-6 w-0.5 rounded-full" style={{ backgroundColor: colors.onData }} />
        </View>
      </GestureDetector>
    </View>
  );
}
