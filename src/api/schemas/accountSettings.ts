import { z } from 'zod';

/** `settingsResponse` (internal/handlers/account_settings.go). `.passthrough()`: a newer API never becomes `contract_mismatch`. */
export const settingsSchema = z
  .object({
    retentionHours: z.number(),
    retentionScope: z.string(),
    deleteMetadataReports: z.boolean(),
    historyVisibility: z.enum(['full', 'names_only']),
    emailAiJobFinished: z.boolean(),
    emailExpiryDigest: z.boolean(),
    currency: z.enum(['usd', 'eur']).nullish(),
    /** Optional until MA23 is deployed; the Notifications push row renders only when present. */
    pushJobFinished: z.boolean().optional(),
    updatedAt: z.string(),
    limits: z.object({
      minHours: z.number(),
      maxHours: z.number(),
      defaultHours: z.number(),
    }),
    /** PATCH only: live items whose expiry moved. */
    restamped: z.number().optional(),
  })
  .passthrough();
export type AccountSettings = z.infer<typeof settingsSchema>;
export type HistoryVisibility = AccountSettings['historyVisibility'];

/** The PATCH body (`settingsPatchBody`): any non-empty subset. */
export interface SettingsPatch {
  retentionHours?: number;
  deleteMetadataReports?: boolean;
  historyVisibility?: HistoryVisibility;
  emailAiJobFinished?: boolean;
  emailExpiryDigest?: boolean;
  pushJobFinished?: boolean;
}

/** `previewResponse`. */
export const retentionPreviewSchema = z
  .object({
    wouldDelete: z.object({
      results: z.number(),
      projects: z.number(),
      other: z.number(),
      bytes: z.number(),
    }),
    earliestDeletionAt: z.string().nullable(),
  })
  .passthrough();
export type RetentionPreview = z.infer<typeof retentionPreviewSchema>;

/** `deleteAllBody` (account_data.go). */
export const deleteAllSchema = z
  .object({
    deleted: z.object({
      objects: z.number(),
      bytes: z.number(),
      projects: z.number(),
      jobs: z.number(),
    }),
    pending: z.number(),
  })
  .passthrough();
export type DeleteAllResult = z.infer<typeof deleteAllSchema>;

/** `AccountDeleteReport` (account_delete.go): 200 when completed, 502 (`incomplete`) when a step failed. */
export const deleteReportSchema = z
  .object({
    status: z.enum(['completed', 'incomplete']),
    steps: z.array(
      z.object({ step: z.string(), status: z.string(), detail: z.string().optional() }),
    ),
    deleted: z
      .object({
        objects: z.number(),
        bytes: z.number(),
        projects: z.number(),
        jobs: z.number(),
        settings: z.number(),
        grants: z.number(),
      })
      .partial(),
    stripe: z.string().optional(),
    analytics: z.string().optional(),
    retryable: z.boolean().optional(),
    message: z.string().optional(),
  })
  .passthrough();
export type AccountDeleteReport = z.infer<typeof deleteReportSchema>;

export const revokeSessionsSchema = z.object({ revokedAt: z.string() }).passthrough();
export type RevokeSessionsResult = z.infer<typeof revokeSessionsSchema>;
