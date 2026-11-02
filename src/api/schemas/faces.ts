import { z } from 'zod';

/** `models.FaceBox` (internal/models/conversion.go). Boxes are normalized [0,1] to the oriented image. */
export const faceBoxSchema = z.object({
  id: z.string().min(1),
  index: z.number().optional(),
  confidence: z.number().optional(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  pixelBox: z
    .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
    .optional(),
});

/** `models.FaceDetectionResponse` (`POST /api/ai/faces/detect`). `faces` is absent/null when none are found. */
export const faceDetectionResponseSchema = z.object({
  faceDetectionSessionId: z.string().min(1),
  imageWidth: z.number().positive(),
  imageHeight: z.number().positive(),
  faces: z
    .array(faceBoxSchema)
    .nullish()
    .transform((f) => f ?? []),
  expiresAt: z.string(),
});
export type FaceDetectionResponse = z.infer<typeof faceDetectionResponseSchema>;
