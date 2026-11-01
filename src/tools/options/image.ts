import type { ToolContext, ToolOptions } from '../types';
import type { ImageConversionOptions } from './imageSchema';

/** Integer source-pixel rectangle. */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const ICO_SIZES = [16, 32, 48, 64, 128, 256] as const;
export const DEFAULT_QUALITY = 85;
export const FILTER_IDS = [
  'grayscale',
  'sepia',
  'blur',
  'sharpen',
  'swirl',
  'barrel-distortion',
  'oil-painting',
  'vintage',
  'emboss',
  'charcoal',
  'sketch',
] as const;
export type FilterId = (typeof FILTER_IDS)[number];

/** Output formats a user can pick for the "same as original" family. */
export type PickFormat = 'jpg' | 'png' | 'webp';
export type SameOrFormat = 'same' | PickFormat;

const SAME_AS_ORIGINAL = new Set(['jpg', 'png', 'webp', 'gif', 'avif']);

/** Decision 4: input extension when it is jpg/png/webp/gif/avif (`jpeg` is `jpg`), else `jpg`. */
export function sameAsOriginalFormat(extension?: string): 'jpg' | 'png' | 'webp' | 'gif' | 'avif' {
  const e = (extension ?? '').toLowerCase().replace(/^\./, '');
  const n = e === 'jpeg' ? 'jpg' : e;
  return (SAME_AS_ORIGINAL.has(n) ? n : 'jpg') as ReturnType<typeof sameAsOriginalFormat>;
}

const inputExt = (ctx?: ToolContext) => ctx?.input?.extension;

function resolveFormat(form: SameOrFormat, ctx?: ToolContext): string {
  return form === 'same' ? sameAsOriginalFormat(inputExt(ctx)) : form;
}

const base = (format: string, quality = DEFAULT_QUALITY, filter = 'none') => ({
  format,
  quality,
  filter,
});

// --- image-convert -------------------------------------------------------------------------------
export interface ConvertForm {
  format: 'jpg' | 'png' | 'webp' | 'gif' | 'avif' | 'ico';
  quality: number;
  icoSizes: number[];
}
export const convertDefaults: ConvertForm = {
  format: 'jpg',
  quality: DEFAULT_QUALITY,
  icoSizes: [...ICO_SIZES],
};
export function buildImageConvertOptions(form: ConvertForm): ImageConversionOptions {
  const out: ImageConversionOptions = base(form.format, form.quality) as ImageConversionOptions;
  if (form.format === 'ico') {
    const sizes = ICO_SIZES.filter((s) => form.icoSizes.includes(s));
    // All six is the server default ladder: omit.
    if (sizes.length > 0 && sizes.length < ICO_SIZES.length) out.ico = { sizes };
  }
  return out;
}

// --- image-to-svg --------------------------------------------------------------------------------
export interface SvgForm {
  threshold: number;
  turdSize: number;
}
export const svgDefaults: SvgForm = { threshold: 50, turdSize: 2 };
export function buildImageToSvgOptions(form: SvgForm): ImageConversionOptions {
  return {
    ...base('svg'),
    vectorize: { threshold: form.threshold, turdSize: form.turdSize },
  } as ImageConversionOptions;
}

// --- image-resize --------------------------------------------------------------------------------
export interface ResizeForm {
  width?: number;
  height?: number;
  keepAspect: boolean;
  /** Which dimension the user edited last; the one kept when keepAspect is on. */
  lastEdited: 'width' | 'height';
  format: SameOrFormat;
}
export const resizeDefaults: ResizeForm = {
  width: 1024,
  keepAspect: true,
  lastEdited: 'width',
  format: 'same',
};
export function buildImageResizeOptions(
  form: ResizeForm,
  ctx?: ToolContext,
): ImageConversionOptions {
  const out = base(resolveFormat(form.format, ctx)) as ImageConversionOptions;
  const { width, height } = form;
  if (form.keepAspect) {
    const keepHeight = form.lastEdited === 'height' && height !== undefined;
    if (keepHeight) out.height = height;
    else if (width !== undefined) out.width = width;
    else if (height !== undefined) out.height = height;
  } else {
    if (width !== undefined) out.width = width;
    if (height !== undefined) out.height = height;
  }
  return out;
}
export function resizeBlockReason(form: ResizeForm, ctx?: ToolContext): string | null {
  const o = buildImageResizeOptions(form, ctx);
  if (o.width === undefined && o.height === undefined) return 'size_required';
  const max = ctx?.limits?.maxOutputHeight;
  // Only an explicit height is tier-gated (handlers/tier_limits.go requestedOutputHeight).
  if (o.height !== undefined && max !== undefined && max > 0 && o.height > max)
    return 'output_height';
  return null;
}

// --- image-compress ------------------------------------------------------------------------------
export interface CompressForm {
  format: 'same' | 'jpg' | 'webp';
  quality: number;
}
export const compressDefaults: CompressForm = { format: 'same', quality: 80 };
export function compressFormat(form: CompressForm, ctx?: ToolContext): 'jpg' | 'webp' {
  if (form.format !== 'same') return form.format;
  return inputExt(ctx)?.toLowerCase() === 'webp' ? 'webp' : 'jpg';
}
export function buildImageCompressOptions(
  form: CompressForm,
  ctx?: ToolContext,
): ImageConversionOptions {
  return base(compressFormat(form, ctx), form.quality) as ImageConversionOptions;
}

// --- image-crop ----------------------------------------------------------------------------------
export type CropAspect = 'free' | '1:1' | '4:3' | '3:4' | '16:9' | '9:16';
export interface CropForm {
  rect: PixelRect | null;
  aspect: CropAspect;
  format: SameOrFormat;
}
export const cropDefaults: CropForm = { rect: null, aspect: 'free', format: 'same' };
export function buildImageCropOptions(form: CropForm, ctx?: ToolContext): ImageConversionOptions {
  const out = base(resolveFormat(form.format, ctx)) as ImageConversionOptions;
  if (form.rect) {
    const r = form.rect;
    out.crop = {
      x: Math.max(0, Math.round(r.x)),
      y: Math.max(0, Math.round(r.y)),
      width: Math.max(1, Math.round(r.width)),
      height: Math.max(1, Math.round(r.height)),
    };
  }
  return out;
}
export const cropBlockReason = (form: CropForm): string | null =>
  form.rect ? null : 'crop_required';

// --- image-filter --------------------------------------------------------------------------------
export interface FilterForm {
  filter: FilterId;
  format: SameOrFormat;
}
export const filterDefaults: FilterForm = { filter: 'grayscale', format: 'same' };
export function buildImageFilterOptions(
  form: FilterForm,
  ctx?: ToolContext,
): ImageConversionOptions {
  return base(
    resolveFormat(form.format, ctx),
    DEFAULT_QUALITY,
    form.filter,
  ) as ImageConversionOptions;
}

// --- image-rotate --------------------------------------------------------------------------------
export type Rotation = 'cw90' | 'r180' | 'ccw90';
export interface RotateForm {
  rotation: Rotation;
  format: SameOrFormat;
}
export const rotateDefaults: RotateForm = { rotation: 'cw90', format: 'same' };
/** U+00BA MASCULINE ORDINAL INDICATOR, not U+00B0 DEGREE SIGN (converter.go filter table). */
export const ORDINAL = 'º';
const ROTATE_FILTER: Record<Rotation, string> = {
  cw90: `rotate-90${ORDINAL}`,
  r180: `rotate-180${ORDINAL}`,
  ccw90: `rotate-270${ORDINAL}`,
};
export function buildImageRotateOptions(
  form: RotateForm,
  ctx?: ToolContext,
): ImageConversionOptions {
  return base(
    resolveFormat(form.format, ctx),
    DEFAULT_QUALITY,
    ROTATE_FILTER[form.rotation],
  ) as ImageConversionOptions;
}

// --- image-text ----------------------------------------------------------------------------------
export type TextGravity = NonNullable<ImageConversionOptions['textOverlay']>['gravity'];
export type TextFont = NonNullable<ImageConversionOptions['textOverlay']>['font'];
export interface TextForm {
  text: string;
  size: number;
  color: string;
  strokeColor: string;
  strokeWidth: number;
  gravity: TextGravity;
  font: TextFont;
  x: number;
  y: number;
  format: SameOrFormat;
}
export const textDefaults: TextForm = {
  text: '',
  size: 48,
  color: '#ffffff',
  strokeColor: '#000000',
  strokeWidth: 0,
  gravity: 'South',
  font: 'default',
  x: 0,
  y: 0,
  format: 'same',
};
export function buildImageTextOptions(form: TextForm, ctx?: ToolContext): ImageConversionOptions {
  return {
    ...base(resolveFormat(form.format, ctx)),
    textOverlay: {
      text: form.text,
      size: form.size,
      color: form.color,
      strokeColor: form.strokeColor,
      strokeWidth: form.strokeWidth,
      gravity: form.gravity,
      font: form.font,
      x: Math.max(0, Math.round(form.x)),
      y: Math.max(0, Math.round(form.y)),
    },
  } as ImageConversionOptions;
}
export const textBlockReason = (form: TextForm): string | null =>
  form.text.trim().length === 0 ? 'text_required' : null;

// --- image-to-pdf --------------------------------------------------------------------------------
export type PdfForm = Record<string, never>;
export const toPdfDefaults: PdfForm = {};
export const buildImageToPdfOptions = (): ImageConversionOptions =>
  base('pdf') as ImageConversionOptions;

// --- pdf-to-image --------------------------------------------------------------------------------
export interface PdfToImageForm {
  format: 'jpg' | 'png';
  pageSelection: 'first' | 'all';
  dpi: 100 | 150 | 200 | 300;
  quality: number;
}
export const pdfToImageDefaults: PdfToImageForm = {
  format: 'jpg',
  pageSelection: 'all',
  dpi: 150,
  quality: 90,
};
export function buildPdfToImageOptions(form: PdfToImageForm): ToolOptions {
  const out: ToolOptions = {
    format: form.format,
    pageSelection: form.pageSelection,
    dpi: form.dpi,
  };
  if (form.format === 'jpg') out.quality = form.quality;
  return out;
}
