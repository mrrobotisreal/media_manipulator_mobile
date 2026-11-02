import type { ToolContext, ToolOptions } from '../types';
import { effectiveStemFormat, type StemFormatChoice } from './stemFormat';

/**
 * Option builders for the eleven AI tools (MA20). Each mirrors a validator in the API
 * (`validateAIImageOptions`, `validateAIAudioOptions`, `validateAIVideoOptions`, `ai_tools.go`) and
 * never sends a combination the converter refuses: no trim, filters, text or metadata modes next to an
 * AI operation. The full image/audio/video base is sent because `validate*Options` demands it.
 */

// ---------------------------------------------------------------- bases (kept local to the AI family)

const imageBase = (format: string): ToolOptions => ({ format, quality: 85, filter: 'none' });
export const AI_AUDIO_BASE = {
  bitrate: '192',
  sampleRate: '44100',
  channels: 'stereo',
  speed: 1,
  volume: 1,
} as const;
export const AI_VIDEO_BASE = {
  format: 'mp4',
  quality: 'medium',
  speed: 1,
  preserveAspectRatio: true,
} as const;

const IMAGE_SAME_FORMATS = new Set(['jpg', 'png', 'webp', 'gif', 'avif']);

/** MA17 decision 4: output = input extension if jpg|png|webp|gif|avif (`jpeg` -> `jpg`), else `jpg`. */
export function sameImageFormat(extension: string | undefined): string {
  const ext = (extension ?? '').toLowerCase().replace(/^\./, '');
  const e = ext === 'jpeg' ? 'jpg' : ext;
  return IMAGE_SAME_FORMATS.has(e) ? e : 'jpg';
}

const AUDIO_SAME_FORMATS = new Set(['mp3', 'wav', 'flac', 'ogg', 'opus']);

/** MA19 decision 4: input mp3|wav|flac|ogg|opus -> same; m4a|aac -> aac; anything else -> mp3. */
export function sameAudioFormat(extension: string | undefined): string {
  const ext = (extension ?? '').toLowerCase().replace(/^\./, '');
  if (AUDIO_SAME_FORMATS.has(ext)) return ext;
  if (ext === 'm4a' || ext === 'aac') return 'aac';
  return 'mp3';
}

const ext = (ctx?: ToolContext) => ctx?.input?.extension;
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

// ---------------------------------------------------------------- remove-background

export const BACKGROUND_MODELS = [
  'birefnet-general',
  'birefnet-general-lite',
  'isnet-general-use',
  'u2net',
  'u2netp',
  'u2net_human_seg',
  'birefnet-portrait',
] as const;
export type BackgroundModel = (typeof BACKGROUND_MODELS)[number];

export interface RemoveBackgroundForm {
  model: BackgroundModel;
}
export const removeBackgroundDefaults: RemoveBackgroundForm = { model: 'birefnet-general' };

export function buildRemoveBackgroundOptions(f: RemoveBackgroundForm): ToolOptions {
  return {
    ...imageBase('png'),
    ai: { enabled: true, operation: 'remove_background', backgroundModel: f.model },
  };
}

// ---------------------------------------------------------------- upscale

export const UPSCALE_MODELS = [
  'realesrgan-x4plus',
  'realesrgan-x4plus-anime',
  'realesr-animevideov3',
] as const;
export type UpscaleModel = (typeof UPSCALE_MODELS)[number];

export interface UpscaleForm {
  scale: 2 | 4;
  model: UpscaleModel;
}
export const upscaleDefaults: UpscaleForm = { scale: 4, model: 'realesrgan-x4plus' };

export function buildUpscaleOptions(f: UpscaleForm): ToolOptions {
  return {
    ...imageBase('png'),
    ai: { enabled: true, operation: 'ai_upscale', upscaleScale: f.scale, upscaleModel: f.model },
  };
}

// ---------------------------------------------------------------- blur-faces

export type FaceStyle = 'blur' | 'pixelate' | 'blackbox';
export type FaceSelectionMode = 'all' | 'only_selected' | 'all_except_selected';

export interface FaceBox {
  id: string;
  index?: number;
  confidence?: number;
  x: number;
  y: number;
  width: number;
  height: number;
}
/** What the form keeps from `POST /ai/faces/detect`, bound to the file it was detected on. */
export interface FaceDetectionState {
  sessionId: string;
  /** ISO time; the server forgets the session 30 min after detection. */
  expiresAt: string;
  imageWidth: number;
  imageHeight: number;
  faces: FaceBox[];
  /** The cached file the boxes belong to (the SHA must match at upload). */
  fileUri: string;
}

export interface BlurFacesForm {
  style: FaceStyle;
  selectionMode: FaceSelectionMode;
  detection: FaceDetectionState | null;
  selected: string[];
}
export const blurFacesDefaults: BlurFacesForm = {
  style: 'blur',
  selectionMode: 'all',
  detection: null,
  selected: [],
};

/** The detection if it belongs to the file the job will run on. */
export function detectionFor(f: BlurFacesForm, ctx?: ToolContext): FaceDetectionState | null {
  const d = f.detection;
  if (!d) return null;
  const uri = ctx?.input?.uri;
  return uri && d.fileUri !== uri ? null : d;
}

export function buildBlurFacesOptions(f: BlurFacesForm, ctx?: ToolContext): ToolOptions {
  const d = detectionFor(f, ctx);
  const faceSelection: Record<string, unknown> = { selectionMode: f.selectionMode };
  if (f.selectionMode !== 'all' && d) {
    faceSelection.sessionId = d.sessionId;
    faceSelection.selectedFaceIds = f.selected;
  }
  return {
    ...imageBase(sameImageFormat(ext(ctx))),
    ai: { enabled: true, operation: 'face_privacy', faceMode: f.style, faceSelection },
  };
}

/** Run stays disabled until the mode has a usable detection (decision 7). */
export function blurFacesBlockReason(f: BlurFacesForm, ctx?: ToolContext): string | null {
  if (f.selectionMode === 'all') return null;
  if (!detectionFor(f, ctx)) return 'needs_detection';
  if (f.selectionMode === 'only_selected' && f.selected.length === 0) return 'select_faces';
  return null;
}

// ---------------------------------------------------------------- redact-text

export type TextDetect = 'pii' | 'all-text';
export type TextRedaction = 'blackbox' | 'blur' | 'pixelate';
export interface RedactTextForm {
  detect: TextDetect;
  style: TextRedaction;
}
export const redactTextDefaults: RedactTextForm = { detect: 'pii', style: 'blackbox' };

export function buildRedactTextOptions(f: RedactTextForm, ctx?: ToolContext): ToolOptions {
  return {
    ...imageBase(sameImageFormat(ext(ctx))),
    ai: { enabled: true, operation: 'redact_text', textDetect: f.detect, textRedaction: f.style },
  };
}

// ---------------------------------------------------------------- remove-object

export interface ObjectRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface RemoveObjectForm {
  rects: ObjectRect[];
}
export const removeObjectDefaults: RemoveObjectForm = { rects: [] };
export const MAX_OBJECT_RECTS = 10;

export function buildRemoveObjectOptions(f: RemoveObjectForm, ctx?: ToolContext): ToolOptions {
  return {
    ...imageBase(sameImageFormat(ext(ctx))),
    ai: {
      enabled: true,
      operation: 'remove_object',
      removeObjectMask: {
        rectangles: f.rects.map((r) => ({
          x: round4(r.x),
          y: round4(r.y),
          width: round4(r.width),
          height: round4(r.height),
        })),
      },
    },
  };
}

export function removeObjectBlockReason(f: RemoveObjectForm): string | null {
  return f.rects.length === 0 ? 'needs_rect' : null;
}

// ---------------------------------------------------------------- clean-voice / remove-noise

export type VoiceOperation = 'clean_voice' | 'remove_background_noise';
export type VoiceForm = Record<string, never>;

export function buildVoiceOptions(operation: VoiceOperation, ctx?: ToolContext): ToolOptions {
  return {
    ...AI_AUDIO_BASE,
    format: sameAudioFormat(ext(ctx)),
    ai: { enabled: true, operation },
  };
}

// ---------------------------------------------------------------- isolate-vocals / remove-vocals

export interface StemForm {
  output: StemFormatChoice;
}
export const stemDefaults: StemForm = { output: 'auto' };

/**
 * Audio input over `/upload` may send `"auto"` (the server resolves, probing `.m4a`). A video goes over
 * `/video-upload/complete`, which never resolves it, so a video sends the concrete format (decision 9).
 */
export function buildStemOptions(
  operation: 'isolate_vocals' | 'remove_vocals',
  f: StemForm,
  ctx?: ToolContext,
): ToolOptions {
  const input = ctx?.input;
  const format =
    input?.mediaKind === 'video' ? effectiveStemFormat(f.output, input.name, input.mime) : f.output;
  return { ...AI_AUDIO_BASE, format, ai: { enabled: true, operation } };
}

// ---------------------------------------------------------------- frame-interpolation

export type InterpFps = 48 | 60 | 120;
export type InterpMaxHeight = 360 | 480 | 720;
export interface FrameInterpolationForm {
  targetFps: InterpFps;
  maxHeight: InterpMaxHeight;
  quality: 'low' | 'medium' | 'high';
  preserveAudio: boolean;
}
export const frameInterpolationDefaults: FrameInterpolationForm = {
  targetFps: 60,
  maxHeight: 720,
  quality: 'medium',
  preserveAudio: true,
};
/** `AI_FRAME_INTERPOLATION_MAX_DURATION_SECONDS` / `_MAX_HEIGHT` (inventory 1.3). */
export const INTERP_SERVER_LIMITS = { maxSeconds: 120, maxHeight: 720 } as const;

export function buildFrameInterpolationOptions(f: FrameInterpolationForm): ToolOptions {
  return {
    ...AI_VIDEO_BASE,
    ai: {
      enabled: true,
      operation: 'frame_interpolation',
      frameInterpolation: {
        targetFps: f.targetFps,
        model: 'rife-v4.6',
        quality: f.quality,
        maxHeight: f.maxHeight,
        preserveAudio: f.preserveAudio,
      },
    },
  };
}

export function frameInterpolationBlockReason(
  _f: FrameInterpolationForm,
  ctx?: ToolContext,
): string | null {
  const d = ctx?.input?.durationSec;
  return d !== undefined && d > INTERP_SERVER_LIMITS.maxSeconds ? 'too_long' : null;
}

// ---------------------------------------------------------------- transcribe

export type TranscribeFormat = 'vtt' | 'srt' | 'txt' | 'json';
export const TRANSCRIBE_FORMATS: readonly TranscribeFormat[] = ['vtt', 'srt', 'txt', 'json'];
export interface TranscribeForm {
  format: TranscribeFormat;
  /** '' = detect automatically; otherwise an ISO-639-1/-2 code. */
  language: string;
  /** Set by the SRT / VTT presets so the funnel keeps the web slug. */
  slugHint?: 'srt-generator' | 'generate-vtt-captions';
}
export const transcribeDefaults: TranscribeForm = { format: 'vtt', language: '' };

const LANGUAGE_CODE = /^[a-z]{2,3}$/;
export const normalizeLanguage = (raw: string) => raw.trim().toLowerCase();
export const isLanguageCode = (raw: string) => LANGUAGE_CODE.test(normalizeLanguage(raw));

export function buildTranscribeOptions(f: TranscribeForm): ToolOptions {
  const language = normalizeLanguage(f.language ?? '');
  return {
    mode: 'transcribe',
    format: f.format,
    ...(language && isLanguageCode(language) ? { language } : {}),
  };
}

export function transcribeBlockReason(f: TranscribeForm): string | null {
  const language = normalizeLanguage(f.language ?? '');
  return language && !isLanguageCode(language) ? 'bad_language' : null;
}

export function transcribeSlug(f: TranscribeForm, ctx?: ToolContext): string {
  if (f.slugHint) return f.slugHint;
  return ctx?.input?.mediaKind === 'audio' ? 'transcribe-audio' : 'transcribe-video';
}
