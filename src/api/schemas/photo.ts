import { z } from 'zod';

/**
 * Aperture routes (media_manipulator_api internal/handlers/photo.go, photo_render.go; RUNBOOK
 * §4.17). `doc` is validated separately with the shared `parsePhotoDoc` (the copied web model),
 * never with a hand-written Zod copy.
 */
export const photoProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  revision: z.number().int(),
  status: z.string(),
  error: z.string().optional(),
  width: z.number(),
  height: z.number(),
  hasAlpha: z.boolean().optional(),
  originalBytes: z.number().optional(),
  originalExt: z.string().optional(),
  originalUrl: z.string().optional(),
  proxyUrl: z.string().optional(),
  thumbUrl: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type PhotoProject = z.infer<typeof photoProjectSchema>;

/** `{project, doc}`: create (201), get, save (200). */
export const photoProjectResponseSchema = z.object({
  project: photoProjectSchema,
  doc: z.unknown().optional(),
});
export type PhotoProjectResponse = z.infer<typeof photoProjectResponseSchema>;

export const photoProjectListSchema = z.object({ projects: z.array(photoProjectSchema) });

/** `GET /photo/capabilities` for the caller's tier. */
export const photoCapabilitiesSchema = z.object({
  enabled: z.boolean(),
  render: z.boolean().optional().default(false),
  formats: z.array(z.string()).optional().default([]),
  maxMegapixels: z.number().optional().default(12),
  photoProjects: z.number().optional().default(0),
  photoBatch: z.number().optional().default(0),
  photoPresets: z.number().optional(),
  aiMasks: z.boolean().optional().default(false),
  heal: z.boolean().optional().default(false),
  tier: z.string().optional(),
});
export type PhotoCapabilities = z.infer<typeof photoCapabilitiesSchema>;

/** `POST /photo/projects/:id/export` 202. */
export const photoExportResponseSchema = z.object({ jobId: z.string().min(1) });

export const PHOTO_EXPORT_FORMATS = ['jpg', 'png', 'webp', 'avif', 'tiff'] as const;
export type PhotoExportFormat = (typeof PHOTO_EXPORT_FORMATS)[number];

/** The export body (photoExportBody). `maxMegapixels` omitted = original size (server clamps to the plan). */
export interface PhotoExportRequest {
  doc?: unknown;
  format: PhotoExportFormat;
  quality: number;
  metadataMode: 'keep' | 'strip';
  maxMegapixels?: number;
  name?: string;
}

/**
 * MM103 account presets (`internal/handlers/photo_presets.go`): one row of `GET /photo/presets`
 * (`layers` only with `?full=1`), and the body of create / get / save. `layers` is parsed layer by
 * layer with the shared `layerSchema` (`presetsApi.ts`), never with a hand-written copy.
 */
export const photoPresetSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  category: z.string().nullable().optional(),
  revision: z.number().int(),
  hasThumbnail: z.boolean().optional().default(false),
  thumbnailUrl: z.string().optional(),
  createdAt: z.string().optional().default(''),
  updatedAt: z.string().optional().default(''),
  layers: z.unknown().optional(),
});
export type PhotoPresetRow = z.infer<typeof photoPresetSchema>;

/** `GET /photo/presets`: `limit` is the tier cap (-1 unlimited), `used` the live count. */
export const photoPresetListSchema = z.object({
  presets: z.array(photoPresetSchema),
  limit: z.number().optional().default(-1),
  used: z.number().optional(),
});
