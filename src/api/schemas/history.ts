import { z } from 'zod';

/**
 * `GET /api/account/history` (`internal/handlers/account.go` `historyEntry`; web `HistoryEntry` in
 * `lib/auth/accountApi.ts`). Every field the server marks `omitempty` is optional here. `status` is an
 * open string so a status the server adds later never fails parsing; unknown keys pass through.
 */
export const historyEntrySchema = z
  .object({
    jobId: z.string().min(1),
    tool: z.string().optional(),
    mode: z.string().optional(),
    mediaKind: z.string().optional(),
    sourceFormat: z.string().optional(),
    targetFormat: z.string().optional(),
    status: z.string(),
    createdAt: z.string(),
    completedAt: z.string().optional(),
    durationMs: z.number().optional(),
    resultFileName: z.string().optional(),
    resultExpiresAt: z.string().optional(),
    expired: z.boolean().optional().default(false),
    /** Presigned S3 GET, absolute, valid 15 minutes. */
    downloadUrl: z.string().optional(),
    /** API-relative path of a locally stored result. */
    downloadPath: z.string().optional(),
    /** MA08: `PUBLIC_API_BASE_URL + /api + downloadPath`. */
    downloadAbsoluteUrl: z.string().optional(),
    metadataAvailable: z
      .object({ original: z.boolean(), result: z.boolean() })
      .partial()
      .optional(),
    retainedObjectId: z.string().optional(),
    deletesOn: z.string().optional(),
    keptLonger: z.boolean().optional(),
  })
  .passthrough();

export type HistoryEntry = z.infer<typeof historyEntrySchema>;

export const historyResponseSchema = z
  .object({
    entries: z.array(historyEntrySchema),
    total: z.number(),
    limit: z.number().optional(),
    offset: z.number().optional(),
  })
  .passthrough();

export type HistoryPage = z.infer<typeof historyResponseSchema>;

/** `PATCH /api/jobs/:jobId/retention` 200. */
export const keepLongerResponseSchema = z
  .object({
    keepForHours: z.number(),
    expiresAt: z.string(),
    keptLonger: z.boolean().optional(),
    updated: z.number().optional(),
  })
  .passthrough();

export type KeepLongerResponse = z.infer<typeof keepLongerResponseSchema>;
