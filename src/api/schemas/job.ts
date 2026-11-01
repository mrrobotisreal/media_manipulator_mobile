import { z } from 'zod';

export const jobStatusSchema = z.enum(['pending', 'processing', 'completed', 'failed']);

/** `models.ConversionJob` (internal/models/conversion.go). No endpoint yet; MA12 adds `getJob`. */
export const conversionJobSchema = z.object({
  id: z.string(),
  status: jobStatusSchema,
  progress: z.number().optional(),
  resultUrl: z.string().optional(),
  error: z.string().optional(),
  originalFile: z.object({ name: z.string(), size: z.number(), type: z.string() }),
  options: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  completedAt: z.string().optional(),
  mode: z.string().optional(),
  currentStage: z.string().optional(),
  stages: z.array(z.record(z.string(), z.unknown())).optional(),
  resultS3Key: z.string().optional(),
  resultFileName: z.string().optional(),
  resultSizeBytes: z.number().optional(),
  resultMime: z.string().optional(),
  expiresAt: z.string().optional(),
  transcodeReport: z.record(z.string(), z.unknown()).optional(),
  metadataAvailable: z.object({ original: z.boolean(), result: z.boolean() }).partial().optional(),
  strippedCount: z.number().optional(),
  queueWaitMs: z.number().optional(),
  assetId: z.string().optional(),
  resultSeconds: z.number().optional(),
});

export type ConversionJob = z.infer<typeof conversionJobSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;

/** `POST /download/:jobId/link` (MM80 + MA08 `absoluteUrl`). */
export const downloadLinkSchema = z.object({
  url: z.string().min(1),
  absoluteUrl: z.string().min(1).optional(),
  expiresAt: z.string().optional(),
  sizeBytes: z.number().optional(),
  fileName: z.string().optional(),
});
export type DownloadLink = z.infer<typeof downloadLinkSchema>;

/** `POST /download/:jobId/mp3` and `GET` (MM81): 202 `{status:'processing'}` / 200 ready, failed, none. */
export const mp3StatusSchema = z.object({
  status: z.enum(['none', 'processing', 'ready', 'failed']),
  url: z.string().optional(),
  absoluteUrl: z.string().optional(),
  expiresAt: z.string().optional(),
  sizeBytes: z.number().optional(),
  fileName: z.string().optional(),
  error: z.string().optional(),
});
export type Mp3Status = z.infer<typeof mp3StatusSchema>;

/** `POST /jobs/:jobId/share` (201, MM32). The plaintext token is returned once. */
export const createdShareSchema = z.object({
  token: z.string().optional(),
  url: z.string().min(1),
  expiresAt: z.string(),
});
export type CreatedShare = z.infer<typeof createdShareSchema>;

/** `DELETE /jobs/:jobId/share` -> `{revoked: n}`. */
export const revokedSharesSchema = z.object({ revoked: z.number().optional() });

/** `DELETE /jobs/:jobId` -> `{deleted:{objects,bytes}, pending}`. */
export const deletedJobSchema = z.object({
  deleted: z.object({ objects: z.number().optional(), bytes: z.number().optional() }).optional(),
  pending: z.number().optional(),
});
export type DeletedJob = z.infer<typeof deletedJobSchema>;
