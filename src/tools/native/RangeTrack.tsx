/* eslint-disable react-hooks/refs -- gesture callbacks read refs and the player is mutated by design. */
import type { ReactNode } from 'react';
import { useRef, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useAppSelector } from '@/state/hooks';
import { Num, Text } from '@/ui/components/Text';
import { formatDuration } from '@/lib/format';
import { colors } from '@/ui/tokens';
import { DEFAULT_MIN_GAP, clampRange, shiftRange, snap, timeToX, xToTime } from './rangeMath';

const HANDLE_W = 14;
const TRACK_H = 56;
const HIT_SLOP = { top: 12, bottom: 12, left: 15, right: 15 };

export interface RangeTrackProps {
  duration: number;
  start: number;
  end: number;
  minGap?: number;
  playhead?: number;
  onChange: (start: number, end: number) => void;
  onScrubStart?: () => void;
  /** The time under the moving handle (for the preview seek). */
  onScrub?: (t: number) => void;
  /** Fires once at the end of each drag (analytics `option: 'trim'`). */
  onScrubEnd?: () => void;
  /** Thumbnail strip or waveform behind the window. */
  background?: ReactNode;
  onTrackWidth?: (w: number) => void;
}

/** Seconds as `m:ss.t` for the readouts (tenths matter on a trim). */
export function formatTenths(t: number): string {
  const whole = formatDuration(Math.floor(t));
  const tenth = Math.floor((t - Math.floor(t)) * 10 + 1e-6);
  return `${whole}.${tenth}`;
}

/**
 * Two handles and a draggable window over a track (time runs left to right in every locale, so the
 * track is forced `direction: 'ltr'`). Controlled: the parent owns start/end. Gestures run on the JS
 * thread (`runOnJS`) like the compare wipe; fine for a handful of updates per frame.
 */
export function RangeTrack(props: RangeTrackProps) {
  const {
    duration,
    start,
    end,
    minGap = DEFAULT_MIN_GAP,
    playhead,
    onChange,
    onScrubStart,
    onScrub,
    onScrubEnd,
    background,
    onTrackWidth,
  } = props;
  const { t } = useTranslation();
  const haptics = useAppSelector((s) => s.settings.haptics);
  const [width, setWidth] = useState(0);
  const begin = useRef({ start: 0, end: 0 });

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setWidth(w);
    onTrackWidth?.(w);
  };

  const tick = () => {
    if (haptics) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };
  const started = () => {
    begin.current = { start, end };
    tick();
    onScrubStart?.();
  };
  const dt = (tx: number) => xToTime(Math.abs(tx), duration, width) * Math.sign(tx);

  const startGesture = Gesture.Pan()
    .runOnJS(true)
    .hitSlop(HIT_SLOP)
    .onBegin(started)
    .onUpdate((e) => {
      const r = clampRange(
        snap(begin.current.start + dt(e.translationX)),
        begin.current.end,
        duration,
        minGap,
        'start',
      );
      onChange(r.start, r.end);
      onScrub?.(r.start);
    })
    .onFinalize(() => onScrubEnd?.());
  const endGesture = Gesture.Pan()
    .runOnJS(true)
    .hitSlop(HIT_SLOP)
    .onBegin(started)
    .onUpdate((e) => {
      const r = clampRange(
        begin.current.start,
        snap(begin.current.end + dt(e.translationX)),
        duration,
        minGap,
        'end',
      );
      onChange(r.start, r.end);
      onScrub?.(r.end);
    })
    .onFinalize(() => onScrubEnd?.());
  const windowGesture = Gesture.Pan()
    .runOnJS(true)
    .onBegin(started)
    .onUpdate((e) => {
      const r = shiftRange(
        begin.current.start,
        begin.current.end,
        snap(dt(e.translationX)),
        duration,
      );
      onChange(snap(r.start), snap(r.end));
      onScrub?.(r.start);
    })
    .onFinalize(() => onScrubEnd?.());

  const x0 = timeToX(start, duration, width);
  const x1 = timeToX(end, duration, width);
  const a11y = (time: number) => formatTenths(time);

  return (
    <View className="gap-2" style={{ direction: 'ltr' }} testID="range-track">
      <View
        onLayout={onLayout}
        style={{
          height: TRACK_H,
          borderRadius: 6,
          overflow: 'hidden',
          backgroundColor: colors.surface2,
        }}
        testID="range-track-bar"
      >
        {background ? <View style={{ position: 'absolute', inset: 0 }}>{background}</View> : null}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            width: x0,
            backgroundColor: 'rgba(10,11,13,0.72)',
          }}
        />
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: x1,
            right: 0,
            backgroundColor: 'rgba(10,11,13,0.72)',
          }}
        />
        <GestureDetector gesture={windowGesture}>
          <View
            testID="range-window"
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: x0,
              width: Math.max(0, x1 - x0),
              borderTopWidth: 2,
              borderBottomWidth: 2,
              borderColor: colors.data,
            }}
          />
        </GestureDetector>
        {playhead !== undefined ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: timeToX(playhead, duration, width),
              width: 2,
              backgroundColor: colors.primary,
            }}
          />
        ) : null}
        <GestureDetector gesture={startGesture}>
          <View
            testID="range-handle-start"
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={t('toolUi.range.a11yStart', { time: a11y(start) })}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(e) => {
              const step = e.nativeEvent.actionName === 'increment' ? 1 : -1;
              const r = clampRange(snap(start + step), end, duration, minGap, 'start');
              onChange(r.start, r.end);
              onScrub?.(r.start);
              onScrubEnd?.();
            }}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: x0 - HANDLE_W,
              width: HANDLE_W,
              backgroundColor: colors.data,
              borderTopLeftRadius: 6,
              borderBottomLeftRadius: 6,
            }}
          />
        </GestureDetector>
        <GestureDetector gesture={endGesture}>
          <View
            testID="range-handle-end"
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={t('toolUi.range.a11yEnd', { time: a11y(end) })}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(e) => {
              const step = e.nativeEvent.actionName === 'increment' ? 1 : -1;
              const r = clampRange(start, snap(end + step), duration, minGap, 'end');
              onChange(r.start, r.end);
              onScrub?.(r.end);
              onScrubEnd?.();
            }}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: x1,
              width: HANDLE_W,
              backgroundColor: colors.data,
              borderTopRightRadius: 6,
              borderBottomRightRadius: 6,
            }}
          />
        </GestureDetector>
      </View>
      <View className="flex-row justify-between">
        <Num className="text-sm" testID="range-readout-start">
          <Text className="text-sm text-muted-fg">{t('toolUi.range.start')} </Text>
          {formatTenths(start)}
        </Num>
        <Num className="text-sm" testID="range-readout-length">
          {t('toolUi.range.length', { duration: formatTenths(Math.max(0, end - start)) })}
        </Num>
        <Num className="text-sm" testID="range-readout-end">
          <Text className="text-sm text-muted-fg">{t('toolUi.range.end')} </Text>
          {formatTenths(end)}
        </Num>
      </View>
    </View>
  );
}

export interface PointTrackProps {
  duration: number;
  value: number;
  onChange: (t: number) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
  background?: ReactNode;
  onTrackWidth?: (w: number) => void;
}

/** One draggable playhead over the same track (frame picking for Extract frames). */
export function PointTrack({
  duration,
  value,
  onChange,
  onScrubStart,
  onScrubEnd,
  background,
  onTrackWidth,
}: PointTrackProps) {
  const { t } = useTranslation();
  const [width, setWidth] = useState(0);
  const begin = useRef(0);
  const g = Gesture.Pan()
    .runOnJS(true)
    .hitSlop(HIT_SLOP)
    .onBegin(() => {
      begin.current = value;
      onScrubStart?.();
    })
    .onUpdate((e) => {
      const d = xToTime(Math.abs(e.translationX), duration, width) * Math.sign(e.translationX);
      onChange(Math.min(duration, Math.max(0, snap(begin.current + d))));
    })
    .onFinalize(() => onScrubEnd?.());
  const x = timeToX(value, duration, width);
  return (
    <View className="gap-2" style={{ direction: 'ltr' }} testID="point-track">
      <View
        onLayout={(e) => {
          setWidth(e.nativeEvent.layout.width);
          onTrackWidth?.(e.nativeEvent.layout.width);
        }}
        style={{
          height: TRACK_H,
          borderRadius: 6,
          overflow: 'hidden',
          backgroundColor: colors.surface2,
        }}
      >
        {background ? <View style={{ position: 'absolute', inset: 0 }}>{background}</View> : null}
        <GestureDetector gesture={g}>
          <View
            testID="point-handle"
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={t('toolUi.range.a11yPoint', { time: formatTenths(value) })}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(e) => {
              onChange(
                Math.min(
                  duration,
                  Math.max(0, snap(value + (e.nativeEvent.actionName === 'increment' ? 1 : -1))),
                ),
              );
              onScrubEnd?.();
            }}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: Math.max(0, x - 7),
              width: 14,
              backgroundColor: colors.primary,
              borderRadius: 4,
            }}
          />
        </GestureDetector>
      </View>
      <Num className="text-sm">{formatTenths(value)}</Num>
    </View>
  );
}
