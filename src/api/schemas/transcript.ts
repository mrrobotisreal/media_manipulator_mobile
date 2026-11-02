import { z } from 'zod';

/** `TranscribeSegmentDTO` (seconds). */
export const transcribeSegmentSchema = z.object({
  id: z.number().optional(),
  start: z.number(),
  end: z.number(),
  text: z.string(),
});

/** `services.TranscribeResult` (`GET /api/transcript/:id`), as the web `lib/useTranscribeResult.ts` reads it. */
export const transcribeResultSchema = z.object({
  format: z.enum(['vtt', 'srt', 'txt', 'json']),
  language: z.string().optional(),
  hasAudio: z.boolean(),
  hasSpeech: z.boolean(),
  segmentCount: z.number(),
  durationSeconds: z.number().optional(),
  transcriptText: z.string().optional(),
  audioDescription: z.string().optional(),
  message: z.string().optional(),
  outputFile: z.string(),
  segments: z
    .array(transcribeSegmentSchema)
    .nullish()
    .transform((s) => s ?? undefined),
  analysisEnqueued: z.boolean().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
});
export type TranscribeResult = z.infer<typeof transcribeResultSchema>;

/** `GET /api/analysis/:id` subset the viewer shows. Every field is optional: the file is model-written. */
export const analysisResultSchema = z.object({
  audioDescription: z.string().optional(),
  error: z.string().optional(),
  transcriptReview: z
    .object({
      summary: z.string().optional(),
      extended_summary: z.string().optional(),
      main_topics: z.array(z.string()).optional(),
      keywords: z.array(z.string()).optional(),
      language: z.string().optional(),
      sentiment_label: z.string().optional(),
      content_safety: z
        .object({
          rating: z.string().optional(),
          labels: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .passthrough()
    .optional(),
});
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
