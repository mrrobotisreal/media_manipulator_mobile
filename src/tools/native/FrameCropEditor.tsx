import { Image, type ImageSource } from 'expo-image';
import { useRef, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { colors } from '@/ui/tokens';
import {
  containFit,
  initialRect,
  moveRect,
  resizeRect,
  roundRect,
  type Corner,
  type Rect,
} from './frameCropMath';

const CORNERS: Corner[] = ['tl', 'tr', 'bl', 'br'];
const HANDLE = 22;

export interface FrameCropEditorProps {
  /** A decoded frame (expo-video thumbnail) or any expo-image source. */
  source: ImageSource | { uri: string };
  /** Display size of the video (rotation applied), in pixels. */
  sourceWidth: number;
  sourceHeight: number;
  value: Rect | null;
  /** w/h, or null for a free rectangle. */
  aspect?: number | null;
  onChange: (rect: Rect) => void;
  onGestureEnd?: () => void;
}

/**
 * Crop rectangle over a still frame. Mirrors the contract MA17 documents for `CropRectEditor`
 * (`{uri, sourceWidth, sourceHeight, value, aspect, onChange}`); this one takes an image `source` so a
 * VideoThumbnail works. Rect values are in SOURCE pixels; an LTR frame, like the range track.
 */
export function FrameCropEditor(props: FrameCropEditorProps) {
  const {
    source,
    sourceWidth: sw,
    sourceHeight: sh,
    aspect = null,
    onChange,
    onGestureEnd,
  } = props;
  const [box, setBox] = useState({ w: 0, h: 0 });
  const rect = props.value ?? initialRect(sw, sh, aspect);
  const begin = useRef<Rect>(rect);
  const fit = containFit(sw, sh, box.w, box.h);

  const onLayout = (e: LayoutChangeEvent) =>
    setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
  const toSrc = (px: number) => (fit.scale > 0 ? px / fit.scale : 0);
  const emit = (r: Rect) => onChange(roundRect(r));

  const drag = Gesture.Pan()
    .runOnJS(true)
    .onBegin(() => {
      begin.current = rect;
    })
    .onUpdate((e) =>
      emit(moveRect(begin.current, toSrc(e.translationX), toSrc(e.translationY), sw, sh)),
    )
    .onFinalize(() => onGestureEnd?.());

  const cornerGesture = (c: Corner) =>
    Gesture.Pan()
      .runOnJS(true)
      .hitSlop(12)
      .onBegin(() => {
        begin.current = rect;
      })
      .onUpdate((e) =>
        emit(
          resizeRect(
            begin.current,
            c,
            toSrc(e.translationX),
            toSrc(e.translationY),
            sw,
            sh,
            aspect,
          ),
        ),
      )
      .onFinalize(() => onGestureEnd?.());

  const left = fit.ox + rect.x * fit.scale;
  const top = fit.oy + rect.y * fit.scale;
  const width = rect.width * fit.scale;
  const height = rect.height * fit.scale;

  return (
    <View
      testID="frame-crop-editor"
      onLayout={onLayout}
      style={{
        width: '100%',
        aspectRatio: sw / sh || 16 / 9,
        direction: 'ltr',
        backgroundColor: colors.surface0,
      }}
    >
      <Image source={source} style={{ position: 'absolute', inset: 0 }} contentFit="contain" />
      <GestureDetector gesture={drag}>
        <View
          testID="frame-crop-rect"
          style={{
            position: 'absolute',
            left,
            top,
            width,
            height,
            borderWidth: 2,
            borderColor: colors.data,
            backgroundColor: 'rgba(94,234,212,0.12)',
          }}
        />
      </GestureDetector>
      {CORNERS.map((c) => (
        <GestureDetector key={c} gesture={cornerGesture(c)}>
          <View
            testID={`frame-crop-${c}`}
            style={{
              position: 'absolute',
              left: (c === 'tl' || c === 'bl' ? left : left + width) - HANDLE / 2,
              top: (c === 'tl' || c === 'tr' ? top : top + height) - HANDLE / 2,
              width: HANDLE,
              height: HANDLE,
              borderRadius: 11,
              backgroundColor: colors.data,
            }}
          />
        </GestureDetector>
      ))}
    </View>
  );
}
