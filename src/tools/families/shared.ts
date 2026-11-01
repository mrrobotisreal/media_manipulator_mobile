import { DefaultsForm } from '../forms/DefaultsForm';
import type {
  AnyToolDefinition,
  MediaKind,
  ResultKind,
  ToolAccepts,
  ToolEndpoint,
  ToolFamily,
  ToolOptions,
} from '../types';

export const IMAGE_ACCEPTS: ToolAccepts = {
  kinds: ['image'],
  mime: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/avif',
    'image/heic',
    'image/heif',
    'image/svg+xml',
    'image/bmp',
    'image/tiff',
    'image/x-icon',
  ],
  extensions: [
    'jpg',
    'jpeg',
    'png',
    'webp',
    'gif',
    'avif',
    'heic',
    'heif',
    'svg',
    'bmp',
    'tif',
    'tiff',
    'ico',
  ],
};

/** Exactly the presign extensions the API allows (video_upload.go isSupportedVideoExtension). */
export const VIDEO_EXTENSIONS = [
  'mp4',
  'mov',
  'm4v',
  'webm',
  'mkv',
  'avi',
  'flv',
  'wmv',
  'mpeg',
  'mpg',
];
export const VIDEO_ACCEPTS: ToolAccepts = {
  kinds: ['video'],
  mime: [
    'video/mp4',
    'video/quicktime',
    'video/x-m4v',
    'video/webm',
    'video/x-matroska',
    'video/x-msvideo',
    'video/x-flv',
    'video/x-ms-wmv',
    'video/mpeg',
  ],
  extensions: VIDEO_EXTENSIONS,
};

export const AUDIO_ACCEPTS: ToolAccepts = {
  kinds: ['audio'],
  mime: [
    'audio/mpeg',
    'audio/wav',
    'audio/x-wav',
    'audio/aac',
    'audio/mp4',
    'audio/ogg',
    'audio/flac',
    'audio/opus',
    'audio/x-ms-wma',
  ],
  extensions: ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'oga', 'flac', 'alac', 'opus', 'wma', 'ac3'],
};

export const PDF_ACCEPTS: ToolAccepts = {
  kinds: ['pdf'],
  mime: ['application/pdf'],
  extensions: ['pdf'],
};

export function mergeAccepts(...parts: ToolAccepts[]): ToolAccepts {
  const kinds: MediaKind[] = [];
  for (const p of parts) for (const k of p.kinds) if (!kinds.includes(k)) kinds.push(k);
  return {
    kinds,
    mime: [...new Set(parts.flatMap((p) => p.mime))],
    extensions: [...new Set(parts.flatMap((p) => p.extensions))],
  };
}

/** Required image options per API validators (format, quality, filter) on web defaults. */
export const imageBase = (extra: ToolOptions = {}): ToolOptions => ({
  format: 'jpg',
  quality: 85,
  filter: 'none',
  ...extra,
});

/** Required video options per API validators (format, speed, quality, preserveAspectRatio). */
export const videoBase = (extra: ToolOptions = {}): ToolOptions => ({
  format: 'mp4',
  speed: 1,
  quality: 'medium',
  preserveAspectRatio: true,
  ...extra,
});

/** Required audio options per API validators. */
export const audioBase = (extra: ToolOptions = {}): ToolOptions => ({
  format: 'mp3',
  bitrate: '192',
  sampleRate: '44100',
  channels: 'stereo',
  speed: 1,
  volume: 1,
  ...extra,
});

interface RowInput {
  id: string;
  family: ToolFamily;
  icon: string;
  accepts: ToolAccepts;
  endpoint: ToolEndpoint;
  defaults: ToolOptions;
  metric: 'ops' | 'ai_ops' | null;
  analyticsSlug: string;
  /** Extra search words; the folded web slugs are added by the caller as hyphen-split words. */
  keywords: string[];
  resultHint: ResultKind;
}

/** Builds a row with the MA10 minimal identity builder and the read-only DefaultsForm. */
export function row(input: RowInput): AnyToolDefinition {
  const { id, ...rest } = input;
  const kebabWords = (s: string) => s.split('-').filter((w) => w.length > 1);
  return {
    id,
    titleKey: `tools.items.${id}.title`,
    descriptionKey: `tools.items.${id}.description`,
    ...rest,
    keywords: [...new Set([...input.keywords.flatMap(kebabWords)])],
    optionsBuilder: (form: ToolOptions) => ({ ...form }),
    Form: DefaultsForm,
    // gpu rule (proposed): AI-family rows that spend ai_ops.
    gpu: input.family === 'ai' && input.metric === 'ai_ops',
  };
}
