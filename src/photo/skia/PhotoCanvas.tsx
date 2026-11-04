/* eslint-disable react-hooks/immutability -- reanimated shared values are mutated by design (`.value =`). */
/**
 * The Aperture preview (MA50 decision 3, MA51 decisions 2–7). A Skia `Canvas` drawing one recorded
 * picture of the document through `PhotoPipeline` (geometry → masks → layers → detail). The
 * picture lives in a Reanimated shared value: a document change re-records it from a store
 * subscription and assigns `.value`, which Skia redraws without a React render of this tree. Zoom
 * and pan are UI-thread transforms (gesture-handler + reanimated, `view.ts` math).
 *
 * Gestures: pinch to zoom around the fingers, pan when zoomed (two fingers whenever a one-finger
 * tool is armed), double tap Fit <-> 100 %, press-and-hold shows the original ("before"), a
 * two-finger tap toggles before/after. With a tool armed, ONE finger belongs to the tool
 * (`ToolOverlay`, drawn on top in the same transform). The canvas is always `direction: 'ltr'`.
 */
import {
  Canvas,
  Group,
  Picture,
  Skia,
  type SkImage,
  type SkPicture,
} from '@shopify/react-native-skia';
import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { PixelRatio, View, type LayoutChangeEvent } from 'react-native';
import {
  Gesture,
  GestureDetector,
  type ComposedGesture,
  type GestureType,
} from 'react-native-gesture-handler';
import {
  useAnimatedReaction,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { colors } from '@/ui/tokens';
import {
  computeHistogram64,
  histogramSize,
  HISTOGRAM_INTERVAL_MS,
  type Histogram64,
} from '../histogram';
import type { PhotoDoc } from '../photoTypes';
import type { ViewState } from '../tools/canvasMath';
import { actualScale, clampOffset, doubleTapTarget, fitScale, pinchTo } from '../view';
import type { MaskView, PhotoPipeline, PipelineSource } from './pipeline';

export type CompareGesture = 'hold' | 'toggle';

export interface DocFeed {
  get(): PhotoDoc | null;
  subscribe(listener: () => void): () => void;
}

/** What the canvas needs from the tool layer (the editor wires `ToolOverlay`). */
export interface CanvasToolHost {
  /** One finger is the tool's (brush, gradient, radial, crop, …); two fingers still pan/zoom. */
  active: boolean;
  /** The tool's own gesture (composed so it races pinch/pan). */
  gesture?: GestureType | ComposedGesture;
  /** Mask view of the selected layer. */
  maskView: MaskView;
  viewLayerId: string | null;
  /** Render without the crop while the crop tool edits it (the web's `ignoreCrop`). */
  ignoreCrop: boolean;
  /** Overlay drawn on top of the picture, in image pixel coordinates. */
  overlay?: (view: SharedValue<ViewState>) => ReactNode;
  /** Changes when the overlay/mask view inputs change (re-record). */
  revision: number;
}

export interface PhotoCanvasProps {
  image: SkImage;
  /** Source id for the pipeline caches (changes when a heal swaps the base). */
  sourceId: string;
  /** Preview pixels per original pixel (proxy / downscale < 1); 100 % means original pixels. */
  previewScale: number;
  doc: DocFeed;
  pipeline: PhotoPipeline;
  tools?: CanvasToolHost;
  /** Bumped when mask rasters arrive (re-record). */
  assetsRevision?: number;
  /** Bumped to request a zoom to 100 % (the Detail sheet's button). */
  zoomActual?: number;
  onHistogram?: (h: Histogram64) => void;
  onCompare?: (mode: CompareGesture, showingBefore: boolean) => void;
  /** The view (image size + transform) for the tools; published on the JS thread. */
  onView?: (v: ViewState) => void;
  testID?: string;
}

const HOLD_MS = 350;

/** The doc the canvas renders (crop removed while the crop tool edits it). */
export function displayDoc(d: PhotoDoc, ignoreCrop: boolean): PhotoDoc {
  return ignoreCrop && d.geometry.crop ? { ...d, geometry: { ...d.geometry, crop: null } } : d;
}

export function PhotoCanvas({
  image,
  sourceId,
  previewScale,
  doc,
  pipeline,
  tools,
  assetsRevision = 0,
  zoomActual = 0,
  onHistogram,
  onCompare,
  onView,
  testID,
}: PhotoCanvasProps) {
  const after = useSharedValue<SkPicture | null>(null);
  const before = useSharedValue<SkPicture | null>(null);
  const showBefore = useSharedValue(false);
  const toggled = useSharedValue(false);
  const empty = useMemo(() => {
    const rec = Skia.PictureRecorder();
    rec.beginRecording(Skia.XYWHRect(0, 0, 1, 1));
    return rec.finishRecordingAsPicture();
  }, []);
  const source: PipelineSource = useMemo(() => ({ image, id: sourceId }), [image, sourceId]);

  const canvasW = useSharedValue(0);
  const canvasH = useSharedValue(0);
  const imgW = useSharedValue(image.width());
  const imgH = useSharedValue(image.height());
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const start = useSharedValue({ scale: 1, x: 0, y: 0 });
  const actual = actualScale(PixelRatio.get(), previewScale);

  const maskView = tools?.maskView ?? 'off';
  const viewLayerId = tools?.viewLayerId ?? null;
  const ignoreCrop = tools?.ignoreCrop ?? false;

  // Re-record on every document change; the shared value hands the picture to the UI thread.
  useEffect(() => {
    let last: PhotoDoc | null = null;
    const record = (d: PhotoDoc, opts: Parameters<PhotoPipeline['render']>[2]) => {
      const r = pipeline.render(source, displayDoc(d, ignoreCrop), opts);
      const rec = Skia.PictureRecorder();
      const canvas = rec.beginRecording(Skia.XYWHRect(0, 0, r.width, r.height));
      const paint = Skia.Paint();
      paint.setShader(r.shader);
      canvas.drawRect(Skia.XYWHRect(0, 0, r.width, r.height), paint);
      return { picture: rec.finishRecordingAsPicture(), width: r.width, height: r.height };
    };
    const draw = () => {
      const d = doc.get();
      if (!d || d === last) return;
      last = d;
      const out = record(d, { maskView, viewLayerId });
      after.value = out.picture;
      before.value = record(d, { before: true }).picture;
      if (out.width !== imgW.value || out.height !== imgH.value) {
        imgW.value = out.width;
        imgH.value = out.height;
        // The output size changed (crop, rotate 90): fit again.
        if (canvasW.value > 0) {
          scale.value = fitScale(
            { width: canvasW.value, height: canvasH.value },
            { width: out.width, height: out.height },
          );
          tx.value = 0;
          ty.value = 0;
        }
      }
    };
    draw();
    return doc.subscribe(draw);
  }, [
    source,
    doc,
    pipeline,
    after,
    before,
    maskView,
    viewLayerId,
    ignoreCrop,
    assetsRevision,
    imgW,
    imgH,
    canvasW,
    canvasH,
    scale,
    tx,
    ty,
  ]);

  // Histogram: a 256 px readback of the adjusted image every 300 ms while the doc changes.
  useEffect(() => {
    if (!onHistogram) return;
    let last: PhotoDoc | null = null;
    const tick = () => {
      const d = doc.get();
      if (!d || d === last) return;
      last = d;
      const size = histogramSize(imgW.value, imgH.value);
      const px = pipeline.readPixels(source, d, size);
      if (px) onHistogram(computeHistogram64(px.pixels));
    };
    tick();
    const id = setInterval(tick, HISTOGRAM_INTERVAL_MS);
    return () => clearInterval(id);
  }, [source, doc, pipeline, imgW, imgH, onHistogram, assetsRevision]);

  const fitNow = useCallback(
    (w: number, h: number) => {
      scale.value = fitScale({ width: w, height: h }, { width: imgW.value, height: imgH.value });
      tx.value = 0;
      ty.value = 0;
    },
    [imgW, imgH, scale, tx, ty],
  );

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    canvasW.value = width;
    canvasH.value = height;
    fitNow(width, height);
  };

  // Detail sheet "100 %": zoom to actual pixels around the centre.
  useEffect(() => {
    if (!zoomActual) return;
    scale.value = withTiming(actual);
    tx.value = withTiming(0);
    ty.value = withTiming(0);
  }, [zoomActual, actual, scale, tx, ty]);

  // The tools read the view on the JS thread.
  const view = useDerivedValue<ViewState>(() => ({
    canvasW: canvasW.value,
    canvasH: canvasH.value,
    imageW: imgW.value,
    imageH: imgH.value,
    scale: scale.value,
    tx: tx.value,
    ty: ty.value,
  }));
  useAnimatedReaction(
    () => view.value,
    (v) => {
      if (onView) scheduleOnRN(onView, v);
    },
  );

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
      const img = { width: imgW.value, height: imgH.value };
      const t = pinchTo(
        start.value,
        e.scale,
        { x: e.focalX, y: e.focalY },
        canvas,
        img,
        fitScale(canvas, img),
        actual,
      );
      scale.value = t.scale;
      tx.value = t.x;
      ty.value = t.y;
    });

  const toolActive = tools?.active ?? false;
  const pan = Gesture.Pan()
    .minDistance(4)
    .minPointers(toolActive ? 2 : 1)
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
        { width: imgW.value, height: imgH.value },
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
        { width: imgW.value, height: imgH.value },
        actual,
        { x: e.x, y: e.y },
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

  const viewGestures = Gesture.Simultaneous(pinch, pan);
  const gesture =
    toolActive && tools?.gesture
      ? Gesture.Race(viewGestures, Gesture.Exclusive(twoFingerTap, tools.gesture))
      : Gesture.Race(viewGestures, Gesture.Exclusive(twoFingerTap, doubleTap, hold));

  const transform = useDerivedValue(() => [
    { translateX: canvasW.value / 2 + tx.value - (imgW.value * scale.value) / 2 },
    { translateY: canvasH.value / 2 + ty.value - (imgH.value * scale.value) / 2 },
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
          {tools?.overlay?.(view)}
        </Canvas>
      </View>
    </GestureDetector>
  );
}
