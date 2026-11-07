import type { RecordingOptions } from 'expo-audio';

/**
 * The voice-sample recording format (ticket MA34 decision 4, proposed): AAC in .m4a, 44.1 kHz, mono,
 * 128 kbps. The API takes any container ffprobe reads (`safeExt` keeps `.m4a`; `validateReference` probes
 * the duration; `NormalizeReference` converts to WAV). Literal enum values (`IOSOutputFormat.MPEG4AAC` =
 * 'aac ', `AudioQuality.MAX` = 127) keep this module free of the native import.
 */
export const VOICE_RECORDING_OPTIONS = {
  extension: '.m4a',
  sampleRate: 44100,
  numberOfChannels: 1,
  bitRate: 128000,
  isMeteringEnabled: true,
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: {
    outputFormat: 'aac ',
    audioQuality: 127,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: 'audio/webm', bitsPerSecond: 128000 },
} as unknown as RecordingOptions;

export const VOICE_RECORDING_MIME = 'audio/mp4';
