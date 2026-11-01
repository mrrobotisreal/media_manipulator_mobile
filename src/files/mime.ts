import type { MediaKind } from '@/tools/types';

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  ico: 'image/x-icon',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  flv: 'video/x-flv',
  wmv: 'video/x-ms-wmv',
  mpeg: 'video/mpeg',
  mpg: 'video/mpeg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  wma: 'audio/x-ms-wma',
  aiff: 'audio/aiff',
  pdf: 'application/pdf',
};

/** Extensions the presign route accepts (media_manipulator_api video_upload.go isSupportedVideoExtension). */
export const PRESIGN_VIDEO_EXTENSIONS: readonly string[] = [
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

const GENERIC_MIME = new Set(['', 'application/octet-stream', 'binary/octet-stream']);

/** Lower-case extension without the dot; '' when the name has none. */
export function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base
    .slice(dot + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 12);
}

/** Keeps the cache path safe: no separators or control characters, bounded length, extension kept. */
export function sanitizeName(name: string, fallback = 'file'): string {
  const base = (name.split(/[\\/]/).pop() ?? '').normalize('NFC');
  // eslint-disable-next-line no-control-regex
  const cleaned = base
    .replace(/[\u0000-\u001f<>:"|?*]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  if (!cleaned) return fallback;
  if (cleaned.length <= 100) return cleaned;
  const ext = extensionOf(cleaned);
  const stem = cleaned.slice(0, cleaned.length - (ext ? ext.length + 1 : 0));
  return `${stem.slice(0, 100 - (ext ? ext.length + 1 : 0))}${ext ? `.${ext}` : ''}`;
}

/** MIME from the declared type, else inferred from the extension (web getFileType rule). */
export function resolveMime(declared: string | null | undefined, extension: string): string {
  const m = (declared ?? '').trim().toLowerCase();
  if (!GENERIC_MIME.has(m)) return m;
  return EXT_MIME[extension] ?? '';
}

/** Kind from the MIME prefix, falling back to the extension; null for anything else. */
export function resolveKind(mime: string, extension: string): MediaKind | null {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf' || extension === 'pdf') return 'pdf';
  const inferred = EXT_MIME[extension];
  if (inferred && inferred !== mime) return resolveKind(inferred, '');
  return null;
}

/** Document-picker / share MIME filters per accepted kind. */
export const KIND_MIME: Record<MediaKind, string> = {
  image: 'image/*',
  video: 'video/*',
  audio: 'audio/*',
  pdf: 'application/pdf',
};
