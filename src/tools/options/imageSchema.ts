import { z } from 'zod';

/**
 * Port of media-manipulator-ui `schemas/imageSchema.ts` (ranges identical) restricted to the fields the
 * image family sends. `.strict()` makes the tests prove nothing else (metadata, gps, ai, tint...) leaks
 * from this family; MA20/MA21 own those.
 */
export const IMAGE_FORMATS = ['jpg', 'png', 'webp', 'gif', 'avif', 'pdf', 'svg', 'ico'] as const;
export const IMAGE_FILTERS = [
  'none',
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
  'rotate-45º',
  'rotate-90º',
  'rotate-180º',
  'rotate-270º',
] as const;
export const TEXT_GRAVITIES = [
  'NorthWest',
  'North',
  'NorthEast',
  'West',
  'Center',
  'East',
  'SouthWest',
  'South',
  'SouthEast',
] as const;
export const TEXT_FONTS = [
  'default',
  'DejaVu-Sans',
  'DejaVu-Serif',
  'DejaVu-Sans-Mono',
  'Liberation-Sans',
  'Liberation-Serif',
  'Liberation-Mono',
] as const;

/** The API's `isSafeImageColor`: six-digit hex only. */
export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const imageConversionSchema = z
  .object({
    format: z.enum(IMAGE_FORMATS),
    width: z.number().int().min(1).max(4096).optional(),
    height: z.number().int().min(1).max(4096).optional(),
    quality: z.number().min(1).max(100),
    filter: z.enum(IMAGE_FILTERS),
    crop: z
      .object({
        x: z.number().int().min(0),
        y: z.number().int().min(0),
        width: z.number().int().min(1),
        height: z.number().int().min(1),
      })
      .strict()
      .optional(),
    textOverlay: z
      .object({
        text: z.string().min(1).max(500),
        size: z.number().min(8).max(512),
        color: z.string().regex(HEX_COLOR),
        strokeColor: z.string().regex(HEX_COLOR),
        strokeWidth: z.number().min(0).max(32),
        gravity: z.enum(TEXT_GRAVITIES),
        font: z.enum(TEXT_FONTS),
        x: z.number().min(0),
        y: z.number().min(0),
      })
      .strict()
      .optional(),
    vectorize: z
      .object({
        threshold: z.number().min(1).max(99),
        turdSize: z.number().min(0).max(1000),
      })
      .strict()
      .optional(),
    ico: z
      .object({ sizes: z.array(z.number().int().min(1).max(256)).min(1) })
      .strict()
      .optional(),
  })
  .strict();

export type ImageConversionOptions = z.infer<typeof imageConversionSchema>;
