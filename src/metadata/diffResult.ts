// Ported from media-manipulator-ui lib/metadata/api.ts @ f67c959 (web main): only the diff schema.
import { z } from 'zod';
import { metadataEntrySchema } from './types';

export const diffResultSchema = z.object({
  removed: z
    .array(metadataEntrySchema)
    .nullish()
    .transform((v) => v ?? []),
  added: z
    .array(metadataEntrySchema)
    .nullish()
    .transform((v) => v ?? []),
  changed: z
    .array(z.object({ id: z.string(), before: z.unknown(), after: z.unknown() }))
    .nullish()
    .transform((v) => v ?? []),
  unchanged: z.number(),
  byCategory: z
    .record(
      z.string(),
      z.object({
        removed: z.number(),
        added: z.number(),
        changed: z.number(),
        unchanged: z.number(),
      }),
    )
    .nullish()
    .transform((v) => v ?? {}),
});
export type DiffResult = z.infer<typeof diffResultSchema>;
