import { z } from 'zod';

/**
 * Zod port of the web `schemas/audioSchema.ts`. Tests parse every non-waveform golden with it;
 * the API's `validateAudioOptions` remains the source of truth (it requires the five base fields).
 */
export const audioConversionSchema = z.object({
  format: z.enum(['mp3', 'wav', 'aac', 'ogg', 'flac', 'alac', 'opus', 'ac3', 'dts']),
  bitrate: z.enum(['128', '192', '256', '320', '512', '1024']).default('192'),
  sampleRate: z.enum(['22050', '44100', '48000', '96000', '192000']).default('44100'),
  channels: z.enum(['mono', 'stereo', '5.1', '7.1']).default('stereo'),
  speed: z.number().min(0.25).max(4).default(1),
  volume: z.number().min(0.1).max(2).default(1),
  trim: z.object({ startTime: z.number().min(0), endTime: z.number().min(0) }).optional(),
  basicProcessing: z
    .object({
      normalize: z.boolean().optional(),
      amplify: z.number().min(-60).max(60).optional(),
      fadeIn: z.number().min(0).max(30).optional(),
      fadeOut: z.number().min(0).max(30).optional(),
      equalizer: z
        .object({
          enabled: z.boolean().default(false),
          preset: z
            .enum(['none', 'bass-boost', 'treble-boost', 'vocal', 'classical', 'rock', 'jazz'])
            .default('none'),
        })
        .optional(),
    })
    .optional(),
  timeBasedEffects: z
    .object({
      reverb: z
        .object({
          enabled: z.boolean().default(false),
          type: z.enum(['none', 'room', 'hall', 'plate', 'spring']).default('none'),
          roomSize: z.number().min(0).max(100).default(50),
          damping: z.number().min(0).max(100).default(50),
          wetLevel: z.number().min(0).max(100).default(30),
          dryLevel: z.number().min(0).max(100).default(70),
        })
        .optional(),
    })
    .optional(),
  advanced: z
    .object({
      pitchShift: z
        .object({
          enabled: z.boolean().default(false),
          semitones: z.number().min(-24).max(24).default(0),
          preserveFormants: z.boolean().default(true),
        })
        .optional(),
    })
    .optional(),
});

export type AudioConversionOptions = z.infer<typeof audioConversionSchema>;
