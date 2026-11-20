import { z } from 'zod';

/**
 * Motion (code name `vector`) project SUMMARY (media_manipulator_api `internal/handlers/vector.go`
 * `vectorProjectBody`): `GET /vector/projects` never carries `document`. The full `VectorDoc` v1
 * is the web's model, copied by MA66; nothing here parses a document.
 *
 * `thumbnailKey` is a private S3 key (MM43). The API serves no read URL for it yet (the web's
 * launcher shows a placeholder glyph for the same reason, MM48), so the phone shows the Motion icon.
 */
export const vectorProjectSummarySchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    revision: z.number().optional(),
    thumbnailKey: z.string().optional(),
    documentBytes: z.number().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .passthrough();
export type VectorProjectSummary = z.infer<typeof vectorProjectSummarySchema>;

export const vectorProjectListSchema = z.object({
  projects: z
    .array(vectorProjectSummarySchema)
    .nullish()
    .transform((p) => p ?? []),
});
