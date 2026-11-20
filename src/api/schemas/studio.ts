import { z } from 'zod';

/**
 * Darkroom (code name `studio`) routes the phone uses in MA58 (media_manipulator_api
 * `internal/handlers/studio.go`, `studio_exports.go`; `models/studio.go`). SUMMARIES ONLY: the
 * full EDL v3 document (`StudioProject`) is the web's `lib/studioTypes.ts`, which MA61 copies
 * byte for byte; these schemas read only the fields the History list and the export sheet need,
 * and pass everything else through (`passthrough`), so the phone never drops a field.
 */

/** One clip, as far as the list reads it (the first video clip's asset gives the thumbnail). */
const studioClipSummarySchema = z
  .object({ assetId: z.string().optional().default('') })
  .passthrough();

const studioTrackSummarySchema = z
  .object({
    kind: z.string(),
    clips: z
      .array(studioClipSummarySchema)
      .nullish()
      .transform((c) => c ?? []),
  })
  .passthrough();

/** `models.StudioProject` as `GET /studio/projects` (newest 25, by `updated_at`) returns it. */
export const studioProjectSummarySchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    durationSeconds: z.number().optional().default(0),
    width: z.number().optional().default(0),
    height: z.number().optional().default(0),
    fps: z.number().optional(),
    tracks: z
      .array(studioTrackSummarySchema)
      .nullish()
      .transform((t) => t ?? []),
    revision: z.number().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .passthrough();
export type StudioProjectSummary = z.infer<typeof studioProjectSummarySchema>;

export const studioProjectListSchema = z.object({
  projects: z
    .array(studioProjectSummarySchema)
    .nullish()
    .transform((p) => p ?? []),
});

/** `models.StudioAsset`, the list fields only (`GET /studio/projects/:id/assets`). */
export const studioAssetSummarySchema = z
  .object({
    id: z.string().min(1),
    mediaKind: z.string(),
    thumbnailSpriteUrl: z.string().optional(),
    durationSeconds: z.number().optional(),
  })
  .passthrough();
export type StudioAssetSummary = z.infer<typeof studioAssetSummarySchema>;

export const studioAssetListSchema = z.object({
  assets: z
    .array(studioAssetSummarySchema)
    .nullish()
    .transform((a) => a ?? []),
});

// --- Output table (MM118) -------------------------------------------------------------------
// `GET /studio/export-options` -> {table: StudioOutputTable, required, caller}
// (`services/studio_outputs.go`; the committed copy is `testdata/studio_outputs.json`). The phone
// keeps NO copy of the table: every combination below comes from this answer.

const outputContainerSchema = z
  .object({
    key: z.string(),
    ext: z.string(),
    mime: z.string(),
    mediaKind: z.string(),
    audioOnly: z.boolean(),
    videoCodecs: z.array(z.string()),
    audioCodecs: z.array(z.string()),
    subtitleCodec: z.string().optional(),
  })
  .passthrough();

const outputCodecSchema = z
  .object({
    key: z.string(),
    kind: z.string(),
    bitrates: z
      .array(z.number())
      .nullish()
      .transform((b) => b ?? []),
    defaultBitrate: z.number().optional().default(0),
    audioCodecs: z.array(z.string()).optional(),
  })
  .passthrough();

const outputWarningSchema = z.object({
  warning: z.string(),
  container: z.string().optional(),
  videoCodec: z.string().optional(),
  audioCodec: z.string().optional(),
});

const outputPresetSchema = z.object({
  key: z.string(),
  container: z.string(),
  videoCodec: z.string(),
  audioCodec: z.string(),
});

export const studioOutputTableSchema = z
  .object({
    containers: z.array(outputContainerSchema).min(1),
    codecs: z.array(outputCodecSchema),
    warnings: z
      .array(outputWarningSchema)
      .nullish()
      .transform((w) => w ?? []),
    presets: z.array(outputPresetSchema).min(1),
    legacyFormats: z.record(z.string(), z.string()).optional().default({}),
    formats: z.array(z.string()).optional().default([]),
    tokens: z.array(z.string()),
    minTier: z.record(z.string(), z.string()).optional().default({}),
    advancedMinTier: z.string().optional().default('premium'),
    defaultChannels: z.number().optional().default(2),
    channels: z.array(z.number()).optional().default([2, 1]),
  })
  .passthrough();
export type StudioOutputTable = z.infer<typeof studioOutputTableSchema>;
export type StudioOutputPreset = z.infer<typeof outputPresetSchema>;

export const studioExportOptionsSchema = z.object({
  table: studioOutputTableSchema,
  /** The lowest public plan per output token, plus `advanced`. */
  required: z.record(z.string(), z.string()),
  caller: z.object({
    tier: z.string(),
    formats: z
      .array(z.string())
      .nullish()
      .transform((f) => f ?? []),
    advanced: z.boolean(),
  }),
});
export type StudioExportOptions = z.infer<typeof studioExportOptionsSchema>;

/**
 * `models.StudioExportRequest` (the body of `POST /studio/projects/:id/export`). Every field is
 * optional; a preset sends `outputPreset`, Advanced the explicit parts (the web's
 * `buildExportRequest`). `format` is the legacy alias and is never sent with the parts.
 */
export interface StudioExportRequest {
  fileName?: string;
  /** QUALITY preset: low | medium | high. */
  preset?: 'low' | 'medium' | 'high';
  /** '' | streaming | podcast | broadcast. */
  loudness?: string;
  format?: string;
  outputPreset?: string;
  container?: string;
  videoCodec?: string;
  audioCodec?: string;
  audioBitrate?: number;
  audioChannels?: number;
  /** Output height: 0 (canvas) | 720 | 1080 | 1440 | 2160. */
  resolution?: number;
  captionsMode?: 'none' | 'burn_in' | 'sidecar' | 'embedded';
}

/** 200 `{jobId}` (`models.UploadResponse`) from export and export-again. */
export const studioExportResponseSchema = z.object({ jobId: z.string().min(1) });

/** `models.StudioExport`, one history row (`GET /studio/projects/:id/exports`, newest first). */
export const studioExportRowSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string(),
    jobId: z.string(),
    preset: z.string().optional(),
    format: z.string(),
    container: z.string().optional().default(''),
    videoCodec: z.string().optional().default(''),
    audioCodec: z.string().optional().default(''),
    audioBitrate: z.number().optional(),
    audioChannels: z.number().optional(),
    resolution: z.number().optional().default(0),
    captionsMode: z.string().optional().default(''),
    loudness: z.string().optional(),
    status: z.string(),
    error: z.string().optional(),
    createdAt: z.string(),
    completedAt: z.string().optional(),
    available: z.boolean().optional().default(false),
  })
  .passthrough();
export type StudioExportRow = z.infer<typeof studioExportRowSchema>;

export const studioExportListSchema = z.object({
  exports: z
    .array(studioExportRowSchema)
    .nullish()
    .transform((e) => e ?? []),
});
