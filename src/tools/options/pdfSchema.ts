import { z } from 'zod';

/** Port of media-manipulator-ui `schemas/pdfSchema.ts` (PDF -> image options), strict. */
export const pdfConversionSchema = z
  .object({
    format: z.enum(['jpg', 'png']),
    pageSelection: z.enum(['all', 'first']),
    dpi: z.number().min(50).max(400),
    quality: z.number().min(1).max(100).optional(),
  })
  .strict();

export type PdfConversionOptions = z.infer<typeof pdfConversionSchema>;
