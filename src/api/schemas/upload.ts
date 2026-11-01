import { z } from 'zod';

/** `models.UploadResponse` (`POST /upload`, `POST /video-upload/complete`). */
export const uploadResponseSchema = z.object({ jobId: z.string().min(1) });
export type UploadResponse = z.infer<typeof uploadResponseSchema>;

/** `models.VideoUploadTarget` (`POST /video-upload/presign`, 201). */
export const videoUploadTargetSchema = z.object({
  uploadUrl: z.string().min(1),
  s3Key: z.string().min(1),
  bucket: z.string().optional(),
  expiresAt: z.string(),
});
export type VideoUploadTarget = z.infer<typeof videoUploadTargetSchema>;

export interface PresignRequest {
  fileName: string;
  contentType: string;
  fileSizeBytes: number;
}

/** `models.VideoUploadCompleteRequest`. */
export interface CompleteRequest {
  s3Key: string;
  fileName: string;
  contentType: string;
  fileSizeBytes: number;
  options: Record<string, unknown>;
}
