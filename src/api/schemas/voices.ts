import { z } from 'zod';

/**
 * Shapes of the `/api/voices/*` answers. Mirrors `media-manipulator-ui/lib/voices/voicesApi.ts` and the Go
 * structs in `media_manipulator_api/internal/handlers/voices.go` (`voicesLimitsBody`, `voiceBody`, `List`,
 * `DesignPreview`, `run`, `newDeletedBody`). The API is the source of truth; unknown extra fields are ignored.
 */
export const voicesLimitsSchema = z.object({
  voicesSaved: z.number(),
  voicesMaxSeconds: z.number(),
  voicesConvert: z.boolean(),
  voicesConvertMaxSeconds: z.number().default(0),
  /** voicesMaxSeconds x 18; 0 = speaking not allowed. */
  textMaxChars: z.number(),
});
export type VoicesLimits = z.infer<typeof voicesLimitsSchema>;

export const voicePresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(''),
  description: z.string().default(''),
  language: z.string().default(''),
  engine: z.string().default(''),
  kind: z.string().default(''),
  /** Languages this preset speaks; empty / null = every capabilities language. */
  languages: z.array(z.string()).nullish(),
});
export type VoicePreset = z.infer<typeof voicePresetSchema>;

export const shiftPresetBodySchema = z.object({
  id: z.string(),
  semitones: z.number(),
  formant: z.enum(['preserved', 'shifted']),
  filter: z.string().optional(),
});
export type ShiftPresetBody = z.infer<typeof shiftPresetBodySchema>;

/** `GET /voices/capabilities`: always 200, also with the service off (`enabled:false`). */
export const voicesCapabilitiesSchema = z.object({
  enabled: z.boolean(),
  warm: z.boolean().default(false),
  languages: z.array(z.string()).default([]),
  designLanguages: z.array(z.string()).default([]),
  presets: z.array(voicePresetSchema).default([]),
  shiftPresets: z.array(shiftPresetBodySchema).default([]),
  signedIn: z.boolean().default(false),
  limits: voicesLimitsSchema,
  tier: z.string().default(''),
});
export type VoicesCapabilities = z.infer<typeof voicesCapabilitiesSchema>;

export const savedVoiceSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  kind: z.string(),
  languageHint: z.string().default('en'),
  description: z.string().optional(),
  seed: z.number().optional(),
  engineVersion: z.string().default(''),
  consentAt: z.string().nullish(),
  consentTextVersion: z.string().optional(),
  /** Presigned, short-lived MP3 of the 6-language preview; absent without S3. */
  previewUrl: z.string().optional(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
});
export type SavedVoice = z.infer<typeof savedVoiceSchema>;

/** `GET /voices`: `limit` is -1 for unlimited. */
export const voicesListSchema = z.object({
  voices: z.array(savedVoiceSchema),
  limit: z.number(),
  used: z.number(),
});
export type VoicesList = z.infer<typeof voicesListSchema>;

/** `POST /voices/design/preview`. */
export const designPreviewSchema = z.object({
  seed: z.number(),
  mime: z.string().default('audio/mpeg'),
  seconds: z.number().default(0),
  audioBase64: z.string().min(1),
});
export type DesignPreview = z.infer<typeof designPreviewSchema>;

/** The 202 answer of speak / preset speak / convert / shift. */
export const voiceJobStartSchema = z.object({
  jobId: z.string().min(1),
  tool: z.enum(['voice_tts', 'voice_convert', 'voice_shift']),
});
export type VoiceJobStart = z.infer<typeof voiceJobStartSchema>;

/** `DELETE /voices/:id`. */
export const voiceDeletedSchema = z.object({
  deleted: z.object({ objects: z.number().optional(), bytes: z.number().optional() }).optional(),
  pending: z.number().optional(),
});
export type VoiceDeleted = z.infer<typeof voiceDeletedSchema>;

/** Request bodies. */
export interface DesignInput {
  description: string;
  language: string;
  /** Keep the previewed voice: the seed the preview returned. */
  seed?: number;
}
export interface SpeakInput {
  text: string;
  language: string;
  /** 0.25 to 2; saved voices only. */
  exaggeration?: number;
}
