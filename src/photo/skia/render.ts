/**
 * Recording and readback around `buildDocShader`, with the Skia API injected (tests run it on
 * CanvasKit). `recordDocPicture` is what the canvas draws; `renderDocPixels` is the readback the
 * histogram (and MA51's eyedropper) use.
 */
import type { SkImage, SkPicture } from '@shopify/react-native-skia';
import type { AdjustmentLayer } from '../photoTypes';
import { buildDocShader, type SkiaApi } from './shaderChain';

const RGBA_8888 = 4;
const UNPREMUL = 3;

/** One picture of the adjusted image in image-pixel space (0,0)-(w,h). `before` = no layers. */
export function recordDocPicture(
  api: SkiaApi,
  image: SkImage,
  layers: readonly AdjustmentLayer[],
  before = false,
): SkPicture {
  const w = image.width();
  const h = image.height();
  const rec = api.PictureRecorder();
  const canvas = rec.beginRecording(api.XYWHRect(0, 0, w, h));
  const paint = api.Paint();
  paint.setShader(buildDocShader(api, image, before ? [] : layers));
  canvas.drawRect(api.XYWHRect(0, 0, w, h), paint);
  return rec.finishRecordingAsPicture();
}

/**
 * The adjusted image drawn into a `width` x `height` raster and read back as unpremultiplied RGBA8
 * (the histogram's 256 px readback). Null when Skia cannot make the surface.
 */
export function renderDocPixels(
  api: SkiaApi,
  image: SkImage,
  layers: readonly AdjustmentLayer[],
  width: number,
  height: number,
): Uint8Array | null {
  const surface = api.Surface.MakeOffscreen(width, height) ?? api.Surface.Make(width, height);
  if (!surface) return null;
  const canvas = surface.getCanvas();
  canvas.scale(width / image.width(), height / image.height());
  const paint = api.Paint();
  paint.setShader(buildDocShader(api, image, layers));
  canvas.drawRect(api.XYWHRect(0, 0, image.width(), image.height()), paint);
  surface.flush();
  const px = surface
    .makeImageSnapshot()
    .readPixels(0, 0, { width, height, colorType: RGBA_8888, alphaType: UNPREMUL });
  return px instanceof Uint8Array ? px : null;
}
