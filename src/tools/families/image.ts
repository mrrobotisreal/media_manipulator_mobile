import { ImageCompressForm } from '../forms/image/ImageCompressForm';
import { ImageConvertForm } from '../forms/image/ImageConvertForm';
import { ImageCropForm } from '../forms/image/ImageCropForm';
import { ImageFilterForm } from '../forms/image/ImageFilterForm';
import { ImageResizeForm } from '../forms/image/ImageResizeForm';
import { ImageRotateForm } from '../forms/image/ImageRotateForm';
import { ImageTextForm } from '../forms/image/ImageTextForm';
import { ImageToPdfForm } from '../forms/image/ImageToPdfForm';
import { ImageToSvgForm } from '../forms/image/ImageToSvgForm';
import { PdfToImageForm } from '../forms/image/PdfToImageForm';
import * as o from '../options/image';
import type { AnyToolDefinition } from '../types';
import { IMAGE_ACCEPTS, PDF_ACCEPTS, imageBase, mergeAccepts, row } from './shared';

/** Replaces the MA10 identity builder / DefaultsForm of a seeded row with the real form + builder. */
function withForm(base: AnyToolDefinition, extra: Partial<AnyToolDefinition>): AnyToolDefinition {
  return { ...base, ...extra };
}

const seeded = [
  row({
    id: 'image-convert',
    family: 'image',
    icon: 'Image',
    accepts: IMAGE_ACCEPTS,
    endpoint: 'upload',
    defaults: imageBase(),
    metric: 'ops',
    analyticsSlug: 'image-converter',
    webTask: 'image_converter',
    resultHint: 'image',
    keywords: [
      'image-converter',
      'convert-heic-to-jpg',
      'convert-avif-to-jpg',
      'convert-svg-to-png',
      'png-to-ico',
      'jpg-converter',
      'png-converter',
      'svg-converter',
      'webp',
      'heic',
      'ico',
      'avif',
    ],
  }),
  row({
    id: 'image-to-svg',
    family: 'image',
    icon: 'Shapes',
    accepts: IMAGE_ACCEPTS,
    endpoint: 'upload',
    defaults: imageBase({ format: 'svg', vectorize: { threshold: 50, turdSize: 2 } }),
    metric: 'ops',
    analyticsSlug: 'convert-png-to-svg',
    webTask: 'png_to_svg',
    resultHint: 'image',
    keywords: ['convert-png-to-svg', 'vector', 'vectorize', 'trace'],
  }),
  row({
    id: 'image-resize',
    family: 'image',
    icon: 'Scaling',
    accepts: IMAGE_ACCEPTS,
    endpoint: 'upload',
    defaults: imageBase({ width: 1024 }),
    metric: 'ops',
    analyticsSlug: 'image-resizer',
    webTask: 'image_resizer',
    resultHint: 'image',
    keywords: ['image-resizer', 'size', 'scale', 'dimensions'],
  }),
  row({
    id: 'image-compress',
    family: 'image',
    icon: 'Minimize2',
    accepts: IMAGE_ACCEPTS,
    endpoint: 'upload',
    defaults: imageBase({ quality: 70 }),
    metric: 'ops',
    analyticsSlug: 'compress-image',
    webTask: 'compress_image',
    resultHint: 'image',
    keywords: ['compress-image', 'smaller', 'shrink', 'reduce'],
  }),
  row({
    id: 'image-crop',
    family: 'image',
    icon: 'Crop',
    accepts: IMAGE_ACCEPTS,
    endpoint: 'upload',
    defaults: imageBase(),
    metric: 'ops',
    analyticsSlug: 'crop-image',
    webTask: 'crop_image',
    resultHint: 'image',
    keywords: ['crop-image', 'cut'],
  }),
  row({
    id: 'image-filter',
    family: 'image',
    icon: 'Palette',
    accepts: IMAGE_ACCEPTS,
    endpoint: 'upload',
    defaults: imageBase({ filter: 'grayscale' }),
    metric: 'ops',
    analyticsSlug: 'image-filters',
    webTask: 'image_filters',
    resultHint: 'image',
    keywords: [
      'image-filters',
      'grayscale-image',
      'sharpen-image',
      'blur-image',
      'sepia',
      'effect',
    ],
  }),
  row({
    id: 'image-rotate',
    family: 'image',
    icon: 'RotateCw',
    accepts: IMAGE_ACCEPTS,
    endpoint: 'upload',
    defaults: imageBase({ filter: 'rotate-90º' }),
    metric: 'ops',
    analyticsSlug: 'rotate-image',
    webTask: 'rotate_image',
    resultHint: 'image',
    keywords: ['rotate-image', 'turn', 'flip'],
  }),
  row({
    id: 'image-text',
    family: 'image',
    icon: 'Type',
    accepts: IMAGE_ACCEPTS,
    endpoint: 'upload',
    defaults: imageBase({ textOverlay: { text: 'Text', size: 48, gravity: 'South' } }),
    metric: 'ops',
    analyticsSlug: 'add-text-to-image',
    webTask: 'add_text_to_image',
    resultHint: 'image',
    keywords: ['add-text-to-image', 'caption', 'watermark', 'overlay'],
  }),
  row({
    id: 'image-to-pdf',
    family: 'image',
    icon: 'FileText',
    accepts: IMAGE_ACCEPTS,
    endpoint: 'upload',
    defaults: imageBase({ format: 'pdf' }),
    metric: 'ops',
    analyticsSlug: 'image-to-pdf',
    webTask: 'image_to_pdf',
    resultHint: 'pdf',
    keywords: ['image-to-pdf', 'convert-jpg-to-pdf', 'convert-png-to-pdf'],
  }),
  row({
    id: 'pdf-to-image',
    family: 'image',
    icon: 'FileImage',
    accepts: mergeAccepts(PDF_ACCEPTS),
    endpoint: 'upload',
    defaults: { format: 'jpg', pageSelection: 'first', dpi: 150, quality: 90 },
    metric: 'ops',
    analyticsSlug: 'pdf-to-jpg',
    webTask: 'pdf_to_jpg',
    resultHint: 'image',
    keywords: ['pdf-to-jpg', 'pdf-to-png', 'pdf-converter'],
  }),
];

const byId = (id: string) => seeded.find((t) => t.id === id)!;

const filterPreset = (slug: string, filter: o.FilterId) => ({
  id: slug,
  titleKey: `tools.image.filters.${filter}`,
  analyticsSlug: slug,
  defaults: { filter },
});

export const imageTools: AnyToolDefinition[] = [
  withForm(byId('image-convert'), {
    Form: ImageConvertForm,
    defaults: o.convertDefaults,
    optionsBuilder: o.buildImageConvertOptions,
    presets: [
      {
        id: 'png-to-ico',
        titleKey: 'tools.image.formats.ico',
        analyticsSlug: 'png-to-ico',
        defaults: { format: 'ico' },
      },
    ],
  }),
  withForm(byId('image-to-svg'), {
    Form: ImageToSvgForm,
    defaults: o.svgDefaults,
    optionsBuilder: o.buildImageToSvgOptions,
  }),
  withForm(byId('image-resize'), {
    Form: ImageResizeForm,
    defaults: o.resizeDefaults,
    optionsBuilder: o.buildImageResizeOptions,
    blockReason: o.resizeBlockReason,
  }),
  withForm(byId('image-compress'), {
    Form: ImageCompressForm,
    defaults: o.compressDefaults,
    optionsBuilder: o.buildImageCompressOptions,
  }),
  withForm(byId('image-crop'), {
    Form: ImageCropForm,
    defaults: o.cropDefaults,
    optionsBuilder: o.buildImageCropOptions,
    blockReason: o.cropBlockReason,
  }),
  withForm(byId('image-filter'), {
    Form: ImageFilterForm,
    defaults: o.filterDefaults,
    optionsBuilder: o.buildImageFilterOptions,
    presets: [
      filterPreset('grayscale-image', 'grayscale'),
      filterPreset('sharpen-image', 'sharpen'),
      filterPreset('blur-image', 'blur'),
    ],
  }),
  withForm(byId('image-rotate'), {
    Form: ImageRotateForm,
    defaults: o.rotateDefaults,
    optionsBuilder: o.buildImageRotateOptions,
  }),
  withForm(byId('image-text'), {
    Form: ImageTextForm,
    defaults: o.textDefaults,
    optionsBuilder: o.buildImageTextOptions,
    blockReason: o.textBlockReason,
  }),
  withForm(byId('image-to-pdf'), {
    Form: ImageToPdfForm,
    defaults: o.toPdfDefaults,
    optionsBuilder: o.buildImageToPdfOptions,
  }),
  withForm(byId('pdf-to-image'), {
    Form: PdfToImageForm,
    defaults: o.pdfToImageDefaults,
    optionsBuilder: o.buildPdfToImageOptions,
    presets: [
      {
        id: 'pdf-to-png',
        titleKey: 'tools.image.formats.png',
        analyticsSlug: 'pdf-to-png',
        defaults: { format: 'png' },
      },
    ],
  }),
];
