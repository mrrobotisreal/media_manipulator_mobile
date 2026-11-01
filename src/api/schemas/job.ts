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
