import { z } from 'zod';

/**
 * `tiers.Limits` (media_manipulator_api internal/tiers/tiers.go). Non-strict: unknown keys
 * pass so additive API changes never break the app. Required = what screens read.
 */
export const tierLimitsSchema = z.object({
  opsPerDay: z.number(),
  aiOpsPerDay: z.number(),
  exportsPerDay: z.number(),
  maxFileBytes: z.number(),
  maxVideoSeconds: z.number(),
  maxOutputHeight: z.number(),
  maxLadderHeight: z.number().optional(),
  priorityGpu: z.boolean(),
  resultRetentionHours: z.number(),
  adsRemoved: z.boolean(),
  rateLimitExempt: z.boolean().optional(),
  summaryMaxFrames: z.number().optional(),
  summaryDeep: z.boolean().optional(),
  studioProjects: z.number().optional(),
  studioVersionAutoKeep: z.number().optional(),
  vectorExportsPerDay: z.number().optional(),
  vectorFormats: z.array(z.string()).optional(),
  vectorProjects: z.number().optional(),
  vectorMaxDurationMs: z.number().optional(),
  vectorVideo: z
    .object({ maxHeight: z.number(), maxFps: z.number(), maxSeconds: z.number() })
    .optional(),
  voicesSaved: z.number().optional(),
  voicesMaxSeconds: z.number().optional(),
  voicesConvert: z.boolean().optional(),
  voicesConvertMaxSeconds: z.number().optional(),
});

export type TierLimits = z.infer<typeof tierLimitsSchema>;
