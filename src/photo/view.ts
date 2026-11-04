/**
 * Pure view math for the photo canvas: fitting the image into the canvas, zoom limits, the
 * double-tap fit <-> 100 % toggle, and pan clamping. Worklet-safe (no closures over imports), so the
 * gesture callbacks call these on the UI thread.
 *
 * Coordinates: `scale` is screen points per image pixel, `x`/`y` the offset of the image centre from
 * the canvas centre in screen points. Always left-to-right (the canvas is `direction: 'ltr'`).
 */
export interface Size {
  width: number;
  height: number;
}

export interface ViewTransform {
  scale: number;
  x: number;
  y: number;
}

/** Points per image pixel when the whole image fits ("Fit"). */
export function fitScale(canvas: Size, image: Size): number {
  'worklet';
  if (canvas.width <= 0 || canvas.height <= 0 || image.width <= 0 || image.height <= 0) return 1;
  return Math.min(canvas.width / image.width, canvas.height / image.height);
}

/**
 * The image's pixel size on screen at 100 % (one image pixel per device pixel), in points. The
 * preview may be a reduced copy (`previewScale` < 1 when a proxy or downscale stands in for the
 * original), so 100 % means the ORIGINAL's pixels.
 */
export function actualScale(pixelRatio: number, previewScale = 1): number {
  'worklet';
  return 1 / Math.max(0.0001, pixelRatio * previewScale);
}

export const MAX_ZOOM_OVER_ACTUAL = 4;

export function clampScale(scale: number, fit: number, actual: number): number {
  'worklet';
  const min = Math.min(fit, actual);
  const max = Math.max(fit, actual) * MAX_ZOOM_OVER_ACTUAL;
  return Math.min(max, Math.max(min, scale));
}

/** Pan stays inside the image: an image smaller than the canvas on an axis is centred on it. */
export function clampOffset(t: ViewTransform, canvas: Size, image: Size): ViewTransform {
  'worklet';
  const w = image.width * t.scale;
  const h = image.height * t.scale;
  const mx = Math.max(0, (w - canvas.width) / 2);
  const my = Math.max(0, (h - canvas.height) / 2);
  return {
    scale: t.scale,
    x: Math.min(mx, Math.max(-mx, t.x)),
    y: Math.min(my, Math.max(-my, t.y)),
  };
}

/**
 * Double tap: at Fit, zoom to 100 % around the tapped point; anywhere else, back to Fit (centred).
 * `focus` is the tap in canvas coordinates (0,0 top-left).
 */
export function doubleTapTarget(
  current: ViewTransform,
  canvas: Size,
  image: Size,
  actual: number,
  focus: { x: number; y: number },
): ViewTransform {
  'worklet';
  const fit = fitScale(canvas, image);
  const atFit = Math.abs(current.scale - fit) < fit * 0.02;
  if (!atFit) return { scale: fit, x: 0, y: 0 };
  // Keep the image point under the finger where it is.
  const k = actual / current.scale;
  const fx = focus.x - canvas.width / 2;
  const fy = focus.y - canvas.height / 2;
  return clampOffset(
    { scale: actual, x: fx - (fx - current.x) * k, y: fy - (fy - current.y) * k },
    canvas,
    image,
  );
}

/** Pinch around a focal point: the image point under the fingers stays put. */
export function pinchTo(
  start: ViewTransform,
  ratio: number,
  focal: { x: number; y: number },
  canvas: Size,
  image: Size,
  fit: number,
  actual: number,
): ViewTransform {
  'worklet';
  const scale = clampScale(start.scale * ratio, fit, actual);
  const k = scale / start.scale;
  const fx = focal.x - canvas.width / 2;
  const fy = focal.y - canvas.height / 2;
  return clampOffset(
    { scale, x: fx - (fx - start.x) * k, y: fy - (fy - start.y) * k },
    canvas,
    image,
  );
}

/** Where the image sits in the canvas (top-left and size in points) for a transform. */
export function imageRect(t: ViewTransform, canvas: Size, image: Size) {
  'worklet';
  const width = image.width * t.scale;
  const height = image.height * t.scale;
  return {
    x: canvas.width / 2 + t.x - width / 2,
    y: canvas.height / 2 + t.y - height / 2,
    width,
    height,
  };
}

/** Max megapixels of the texture the preview shader samples (ticket decision 4, proposed 8). */
export const PHOTO_PREVIEW_MAX_MP = 8;
/**
 * Largest original decoded on the phone (proposed 24, MA50 deviation): between 8 and 24 MP the
 * local decode is downscaled to 8 MP at once, so a 12 MP phone photo shows before the upload ends
 * (Device check 1); above 24 MP (a 96 MB RGBA decode) the editor waits for the server proxy.
 */
export const PHOTO_LOCAL_DECODE_MAX_MP = 24;

const mp = (w: number, h: number) => (w * h) / 1_000_000;

/** Whether a source of this size is previewed from the server proxy instead of a local decode. */
export function needsProxy(width: number | undefined, height: number | undefined): boolean {
  if (!width || !height) return false;
  return mp(width, height) > PHOTO_LOCAL_DECODE_MAX_MP;
}

/** The preview texture size for a decoded image: at most `PHOTO_PREVIEW_MAX_MP`, aspect kept. */
export function previewSize(
  width: number,
  height: number,
): { width: number; height: number; scale: number } {
  if (mp(width, height) <= PHOTO_PREVIEW_MAX_MP) return { width, height, scale: 1 };
  const scale = Math.sqrt((PHOTO_PREVIEW_MAX_MP * 1_000_000) / (width * height));
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
    scale,
  };
}
