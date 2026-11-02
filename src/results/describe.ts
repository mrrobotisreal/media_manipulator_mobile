/**
 * Result descriptor: the pure answer to "what did this job produce?" (MA13).
 *
 * Port of media-manipulator-ui `lib/results/describe.ts`, copied from web `main` @ 5e276a9
 * (the last commit touching that file) on 2026-11-01. Keep the tables in step with the web file.
 *
 * THE KIND COMES FROM THE FILE NAME, NOT FROM Content-Type. `GET /download/:jobId` always
 * answers `application/octet-stream`; the only honest signal is the job's `resultFileName`
 * extension, then (when the API did not name the file) the task or workflow mode.
 *
 * RN deviations from the web file (recorded in design/TOOLS_V1.md section 10):
 *  - `File` (DOM) inputs become `OriginalRef {uri, name, mime, kind}`; `objectUrl` becomes `uri`.
 *  - `downloadUrl` is built from `API_BASE_URL` (EXPO_PUBLIC_API_BASE_URL), not `getBaseURL()`.
 *  - `task` is the registry row's `webTask` (the web EmbeddedTask for the row's slug).
 *  - The transcode probe (`probe`) and `sourceUrl` (public share page) fields are dropped: v1 has
 *    no HLS/DASH viewer and no public share route.
 *  - After the hint, the server's sniffed `resultMime` decides the kind (a History re-open has no
 *    file name and no task; found on the S25, 2026-11-02).
 */
import { API_BASE_URL } from '@/api/config';

export type ResultKind =
  | 'image'
  | 'video'
  | 'gif'
  | 'audio'
  | 'transcript'
  | 'captions'
  | 'pdf'
  | 'archive'
  | 'hls'
  | 'dash'
  | 'metadata'
  // MM75: a chaptered video/audio summary (summary.md + summary.json).
  | 'summary'
  | 'unknown';

/** Workflow mode of the job. Mirrors the home converter's modes; anything else is `convert`. */
export type ResultMode = 'convert' | 'transcribe' | 'transcode' | 'document' | (string & {});

/** The slice of a job `describe()` reads. `ConversionJob` satisfies it. */
export interface DescribableJob {
  id: string;
  resultFileName?: string;
  resultSizeBytes?: number;
  expiresAt?: string;
  /** Server-sniffed MIME; `application/octet-stream` is treated as absent. */
  resultMime?: string;
  resultUrl?: string;
  metadataAvailable?: { original?: boolean; result?: boolean };
  strippedCount?: number;
  queueWaitMs?: number;
}

/** A local copy of the uploaded original (`cache/originals/<jobId>/`). */
export interface OriginalRef {
  uri: string;
  name: string;
  mime?: string;
  kind: ResultKind;
}

export interface ResultDescriptor {
  kind: ResultKind;
  mime: string;
  fileName: string;
  sizeBytes?: number;
  jobId: string;
  downloadUrl: string;
  expiresAt?: string;
  /** True when `job.resultMime` was a usable MIME (inline-streaming viewers may use it). */
  mimeFromServer: boolean;
  /** Set when an original exists to compare against. */
  original?: OriginalRef;
  metadataAvailable?: { original?: boolean; result?: boolean };
  strippedCount?: number;
  queueWaitMs?: number;
}

export interface DescribeInput {
  job: DescribableJob;
  /** The web EmbeddedTask (`compress_video`, `transcribe_video`, ...): the registry `webTask`. */
  task?: string;
  mode?: ResultMode;
  /** Used only when no extension and no task decide the kind (the registry `resultHint`). */
  kindHint?: ResultKind;
  /** Name to show when the API sent no `resultFileName`. */
  fallbackFileName?: string;
  original?: OriginalRef;
}

const IMAGE_EXT = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'avif',
  'bmp',
  'tiff',
  'tif',
  'ico',
  'svg',
  'heic',
]);
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus']);
const ARCHIVE_EXT = new Set(['zip', 'tar.gz', 'tgz']);

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  heic: 'image/heic',
  gif: 'image/gif',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  srt: 'application/x-subrip',
  vtt: 'text/vtt',
  txt: 'text/plain',
  json: 'application/json',
  md: 'text/markdown',
  pdf: 'application/pdf',
  zip: 'application/zip',
  'tar.gz': 'application/gzip',
  tgz: 'application/gzip',
};

/**
 * Lower-cased extension of a file name. `.tar.gz` is one extension; everything else is the
 * text after the last dot. Returns '' for names without one.
 */
export function extensionOf(fileName: string | undefined): string {
  const name = (fileName ?? '').trim().toLowerCase();
  if (!name) return '';
  if (name.endsWith('.tar.gz')) return 'tar.gz';
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1);
}

/**
 * Kind of a task whose output type is fixed, used only when the job named no file.
 * Converter tasks whose output depends on the chosen format are deliberately absent: with no
 * extension and no hint those are `unknown` rather than a guess.
 */
const KIND_BY_TASK: Record<string, ResultKind> = {
  inspect_metadata: 'metadata',
  transcribe_video: 'transcript',
  srt_generator: 'captions',
  caption_translator: 'captions',
  caption_translate: 'captions',
  extract_frames: 'archive',
  transcode_to_hls: 'hls',
  transcode_to_dash: 'dash',
  ai_video_restoration: 'archive',
  stitch_audio_to_video: 'video',
  ai_frame_interpolation: 'video',
  compress_video: 'video',
  video_compressor: 'video',
  compress_mp4: 'video',
  video_trimmer: 'video',
  mp4_trimmer: 'video',
  video_cutter: 'video',
  cut_video_online: 'video',
  crop_video: 'video',
  resize_video: 'video',
  rotate_video: 'video',
  remove_audio_from_video: 'video',
  extract_video_only: 'video',
  video_to_gif: 'gif',
  mp4_to_gif: 'gif',
  extract_audio: 'audio',
  mp4_to_mp3: 'audio',
  video_to_mp3: 'audio',
  wav_to_mp3: 'audio',
  isolate_vocals: 'audio',
  audio_converter: 'audio',
  image_to_pdf: 'pdf',
  jpg_to_pdf: 'pdf',
  png_to_pdf: 'pdf',
  remove_background: 'image',
  image_resizer: 'image',
  compress_image: 'image',
  png_to_jpg: 'image',
  jpg_to_png: 'image',
  webp_to_jpg: 'image',
  webp_to_png: 'image',
  png_to_webp: 'image',
  jpg_to_webp: 'image',
  heic_to_jpg: 'image',
  avif_to_jpg: 'image',
  avif_to_png: 'image',
  svg_to_png: 'image',
  png_to_svg: 'image',
  png_to_ico: 'image',
  mov_to_mp4: 'video',
  webm_to_mp4: 'video',
  avi_to_mp4: 'video',
  mkv_to_mp4: 'video',
  mp4_to_webm: 'video',
  mp4_converter: 'video',
  // Catalog expansion (2026-10-28).
  change_video_speed: 'video',
  reverse_video: 'video',
  flip_video: 'video',
  stabilize_video: 'video',
  change_video_frame_rate: 'video',
  adjust_video_color: 'video',
  video_to_hevc: 'video',
  audio_to_wav: 'audio',
  audio_to_flac: 'audio',
  audio_to_ogg: 'audio',
  audio_to_m4a: 'audio',
  audio_to_opus: 'audio',
  mp3_to_wav: 'audio',
  change_audio_speed: 'audio',
  change_audio_pitch: 'audio',
  normalize_audio: 'audio',
  adjust_audio_volume: 'audio',
  audio_equalizer: 'audio',
  add_reverb: 'audio',
  trim_audio: 'audio',
  add_text_to_image: 'image',
  crop_image: 'image',
  grayscale_image: 'image',
  image_filters: 'image',
  rotate_image: 'image',
  sharpen_image: 'image',
  blur_image: 'image',
  edit_image_metadata: 'image',
  transcribe_audio: 'transcript',
  audio_to_text: 'transcript',
  video_to_text: 'transcript',
  // MM75: both summary tasks, and the API's tool id as History reports it.
  summarize_video: 'summary',
  summarize_audio: 'summary',
  video_summary: 'summary',
  generate_vtt_captions: 'captions',
  // MM78 voices: every voice job's result is speech.mp3 (audio). The job tools and the
  // page tasks both map, whichever the surface passes.
  voice_tts: 'audio',
  voice_convert: 'audio',
  voice_shift: 'audio',
  voice_clone: 'audio',
  voice_design: 'audio',
};

/** First extension per MIME (jpg over jpeg, mp4 over m4v). */
const EXT_BY_MIME: Record<string, string> = Object.entries(MIME_BY_EXT).reduce<
  Record<string, string>
>((acc, [ext, mime]) => (acc[mime] ? acc : { ...acc, [mime]: ext }), {});

const isUsableMime = (mime: string | undefined): mime is string =>
  !!mime && !/^application\/octet-stream/i.test(mime.trim());

function isDashTask(task: string | undefined, mode: string | undefined): boolean {
  return /dash/i.test(task ?? '') || /dash/i.test(mode ?? '');
}

/** Kind of a file by extension alone, given the workflow context. `null` = undecided. */
function kindFromExtension(ext: string, ctx: { task?: string; mode?: string }): ResultKind | null {
  if (!ext) return null;
  if (ext === 'gif') return 'gif';
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (ext === 'srt' || ext === 'vtt') return 'captions';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'txt' || ext === 'json') {
    const transcribing = ctx.mode === 'transcribe' || KIND_BY_TASK[ctx.task ?? ''] === 'transcript';
    return transcribing ? 'transcript' : null;
  }
  if (ARCHIVE_EXT.has(ext)) {
    // A transcode job's package is a tarball, but it is an HLS/DASH bundle, not a gallery.
    if (ctx.mode === 'transcode' || /^transcode_to_/.test(ctx.task ?? '')) {
      return isDashTask(ctx.task, ctx.mode) ? 'dash' : 'hls';
    }
    return 'archive';
  }
  return null;
}

/** Mime for a descriptor: the server's when usable, else the extension table, else octet-stream. */
function mimeFor(job: DescribableJob, ext: string): { mime: string; fromServer: boolean } {
  if (isUsableMime(job.resultMime)) return { mime: job.resultMime.trim(), fromServer: true };
  return { mime: MIME_BY_EXT[ext] ?? 'application/octet-stream', fromServer: false };
}

/** Best-guess MIME of a file by name (for blob URLs of archive entries). */
export function mimeForFileName(fileName: string): string {
  const ext = extensionOf(fileName);
  if (ext === 'm3u8') return 'application/vnd.apple.mpegurl';
  if (ext === 'mpd') return 'application/dash+xml';
  if (ext === 'm4s' || ext === 'mp4') return 'video/mp4';
  if (ext === 'ts') return 'video/mp2t';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

/** Kind of a file inside an archive, by name alone (no task context); `unknown` when undecided. */
export function kindOfFileName(fileName: string): ResultKind {
  const ext = extensionOf(fileName);
  // Nested archives are plain archives here; stream bundles only get hls/dash from a job's task.
  return kindFromExtension(ext, {}) ?? (/\.(m3u8|mpd)$/i.test(fileName) ? 'metadata' : 'unknown');
}

/**
 * Last resort (app deviation): a job opened by id (History re-open) has no `resultFileName` and no
 * registry task, so the server's sniffed `resultMime` names the media family. Only the families a
 * viewer exists for; anything else stays undecided.
 */
function kindFromServerMime(mime: string | undefined): ResultKind | null {
  if (!isUsableMime(mime)) return null;
  const type = mime.trim().toLowerCase();
  if (type === 'image/gif') return 'gif';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type === 'application/pdf') return 'pdf';
  if (type === 'application/zip') return 'archive';
  return null;
}

/** Kind of an uploaded original, for the compare modes. */
export function kindOfOriginal(
  file: { name?: string; mime?: string } | null | undefined,
): ResultKind {
  if (!file) return 'unknown';
  const type = file.mime || '';
  if (type === 'image/gif') return 'gif';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type === 'application/pdf') return 'pdf';
  return kindFromExtension(extensionOf(file.name), {}) ?? 'unknown';
}

export function describe(input: DescribeInput): ResultDescriptor {
  const { job, task, mode, kindHint, fallbackFileName } = input;
  // A job opened by id has no file name; give the fallback the extension of the sniffed MIME so a saved
  // copy is a real `.jpg`/`.mp4` (Android files an extensionless file outside Photos/Music).
  const mimeExt = isUsableMime(job.resultMime)
    ? EXT_BY_MIME[job.resultMime.trim().toLowerCase()]
    : undefined;
  const fileName =
    job.resultFileName || fallbackFileName || `result-${job.id}${mimeExt ? `.${mimeExt}` : ''}`;
  const ext = extensionOf(job.resultFileName || fallbackFileName);
  const ctx = { task, mode };

  // Extension first, then the task, then the surface's hint; Content-Type is never consulted.
  const kind: ResultKind =
    kindFromExtension(ext, ctx) ??
    (mode === 'transcode' ? (isDashTask(task, mode) ? 'dash' : 'hls') : null) ??
    (task ? KIND_BY_TASK[task] : undefined) ??
    (mode === 'summarize' ? 'summary' : null) ??
    (mode === 'transcribe' ? 'transcript' : null) ??
    kindHint ??
    kindFromServerMime(job.resultMime) ??
    'unknown';

  const { mime, fromServer } = mimeFor(job, ext);

  return {
    kind,
    mime,
    fileName,
    sizeBytes: job.resultSizeBytes,
    jobId: job.id,
    downloadUrl: job.resultUrl || `${API_BASE_URL}/download/${job.id}`,
    expiresAt: job.expiresAt,
    mimeFromServer: fromServer,
    original: input.original,
    ...(job.metadataAvailable ? { metadataAvailable: job.metadataAvailable } : {}),
    ...(job.strippedCount ? { strippedCount: job.strippedCount } : {}),
    ...(typeof job.queueWaitMs === 'number' && job.queueWaitMs >= 0
      ? { queueWaitMs: job.queueWaitMs }
      : {}),
  };
}
