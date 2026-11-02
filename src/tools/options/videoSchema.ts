import { z } from 'zod';

/**
 * Zod port of the part of the web `schemas/videoSchema.ts` (media-manipulator-ui @ main) that the
 * phone sends, with the ranges of API `validateVideoOptions`. The web's unused advanced blocks
 * (`advanced`, `visualEffects.motionBlur/unsharpMask/noise/artistic`, `temporal.variableSpeed/pingPong`,
 * `transform.padding`) and `ai` / `metadataMode` are deliberately absent: `.strict()` makes a builder
 * that sends one fail its golden test.
 */
export const VIDEO_CONTAINERS = ['mp4', 'webm', 'mov', 'mkv', 'avi'] as const;
export type VideoContainer = (typeof VIDEO_CONTAINERS)[number];

const colorEffects = z
  .object({
    brightness: z.number().int().min(-100).max(100).optional(),
    contrast: z.number().int().min(-100).max(100).optional(),
    saturation: z.number().int().min(-100).max(100).optional(),
    hue: z.number().int().min(-180).max(180).optional(),
    gamma: z.number().min(0.1).max(3).optional(),
  })
  .strict();

export const videoConversionOptionsSchema = z
  .object({
    format: z.enum(['mp4', 'webm', 'avi', 'mov', 'mkv', 'gif']),
    // Required by the API validator although the web schema defaults them.
    quality: z.enum(['low', 'medium', 'high']),
    speed: z.number().min(0.25).max(4),
    preserveAspectRatio: z.boolean(),
    width: z.number().int().min(1).max(4096).optional(),
    height: z.number().int().min(1).max(4096).optional(),
    videoCodec: z.enum(['h264', 'h265']).optional(),
    crf: z.number().int().min(0).max(51).optional(),
    stripAudio: z.boolean().optional(),
    trim: z
      .object({ startTime: z.number().min(0), endTime: z.number().min(0) })
      .strict()
      .refine((t) => t.endTime > t.startTime, 'end after start')
      .optional(),
    gif: z
      .object({
        width: z.number().int().min(16).max(2000),
        fps: z.number().int().min(1).max(50),
        colors: z.number().int().min(2).max(256),
        delay: z.number().int().min(1).max(100),
        optimize: z.number().int().min(1).max(3),
      })
      .strict()
      .optional(),
    visualEffects: colorEffects.optional(),
    transform: z
      .object({
        rotation: z.number().min(-360).max(360).optional(),
        flipHorizontal: z.boolean().optional(),
        flipVertical: z.boolean().optional(),
        crop: z
          .object({
            x: z.number().int().min(0),
            y: z.number().int().min(0),
            width: z.number().int().min(1),
            height: z.number().int().min(1),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    temporal: z
      .object({
        reverse: z.boolean().optional(),
        frameRate: z
          .object({ target: z.number().min(1).max(120), interpolation: z.boolean() })
          .strict()
          .optional(),
        stabilization: z
          .object({
            enabled: z.boolean(),
            shakiness: z.number().int().min(1).max(10),
            accuracy: z.number().int().min(1).max(15),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type VideoConversionOptions = z.infer<typeof videoConversionOptionsSchema>;

export const trimVideoOptionsSchema = z
  .object({
    mode: z.literal('trim_video'),
    format: z.enum(['mp4', 'webm', 'mov', 'mkv', 'avi']),
    startTime: z.number().min(0),
    endTime: z.number().positive(),
    copyMode: z.enum(['auto', 'reencode']),
  })
  .strict()
  .refine((o) => o.endTime - o.startTime >= 0.1, 'at least 0.1 s')
  .refine((o) => o.endTime - o.startTime <= 6 * 3600, 'at most 6 h');

export const extractAudioOptionsSchema = z
  .object({
    mode: z.literal('extract_audio'),
    format: z.enum(['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg']),
  })
  .strict();

export const extractVideoOnlyOptionsSchema = z
  .object({ mode: z.literal('extract_video_only'), format: z.enum(['mp4', 'webm']) })
  .strict();

export const extractFramesOptionsSchema = z
  .object({
    mode: z.literal('extract_frames'),
    frameMode: z.enum(['every_n_seconds', 'fps', 'timestamp']),
    format: z.enum(['jpg', 'png', 'webp']),
    maxFrames: z.number().int().min(1).max(1000),
    intervalSeconds: z.number().min(0.1).max(600).optional(),
    fps: z.number().min(0.05).max(60).optional(),
    timestamps: z.array(z.number().min(0)).min(1).optional(),
  })
  .strict()
  .refine((o) => {
    const present = [o.intervalSeconds, o.fps, o.timestamps].filter((x) => x !== undefined).length;
    return present === 1;
  }, 'exactly one of intervalSeconds / fps / timestamps')
  .refine((o) => !o.timestamps || o.timestamps.length <= o.maxFrames, 'timestamps <= maxFrames');
