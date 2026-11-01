import type { ToolBuildContext, ToolOptions } from '../types';
import type { VideoContainer } from './videoSchema';

/**
 * Option builders for the ten video tools (MA18). The API (`validateVideoOptions`, the specialized
 * modes in specialized_tools.go) is the source of truth: every tool that sends `format` also sends
 * `quality`, `speed` and `preserveAspectRatio` (a missing speed reads as 0 and is rejected); `mode`
 * tools send only their mode's keys. Never sent: `metadataMode`, `ai`, `advanced`, padding,
 * variableSpeed, pingPong, motionBlur, unsharpMask, noise, artistic.
 */

export type FormatChoice<T extends string = VideoContainer> = T | 'same';

export const MAX_SIDE = 4096;
export const TRIM_MIN_GAP = 0.1;
export const TRIM_MAX_SEC = 6 * 3600;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Decision 4: the input container when the API can write it, else MP4. */
export function resolveContainer<T extends string>(
  choice: FormatChoice<T>,
  ctx: ToolBuildContext | undefined,
  allowed: readonly T[],
): T | 'mp4' {
  if (choice !== 'same') return choice;
  const ext = ctx?.file?.extension?.toLowerCase();
  const hit = allowed.find((a) => a === ext);
  return hit ?? 'mp4';
}

const base = (format: string, extra: ToolOptions = {}): ToolOptions => ({
  format,
  quality: 'medium',
  speed: 1,
  preserveAspectRatio: true,
  ...extra,
});

// --- video-convert ------------------------------------------------------------------------------
export interface ConvertForm {
  format: VideoContainer;
  codec: 'auto' | 'h264' | 'h265';
  quality: 'low' | 'medium' | 'high';
}
export const CONVERT_DEFAULTS: ConvertForm = { format: 'mp4', codec: 'auto', quality: 'medium' };
export const CODEC_FORMATS: readonly VideoContainer[] = ['mp4', 'mov', 'mkv'];

export function buildConvert(f: ConvertForm): ToolOptions {
  const o = base(f.format, { quality: f.quality });
  if (f.codec !== 'auto' && CODEC_FORMATS.includes(f.format)) o.videoCodec = f.codec;
  return o;
}

// --- video-compress -----------------------------------------------------------------------------
export type CompressLevel = 'smallest' | 'balanced' | 'high_quality';
/** Web `video-compressor-panel.tsx` LEVEL_CRF / LEVEL_QUALITY. */
export const LEVEL_CRF: Record<CompressLevel, number> = {
  smallest: 31,
  balanced: 26,
  high_quality: 22,
};
export const LEVEL_QUALITY: Record<CompressLevel, 'low' | 'medium' | 'high'> = {
  smallest: 'low',
  balanced: 'medium',
  high_quality: 'high',
};
export interface CompressForm {
  level: CompressLevel;
  format: 'mp4' | 'webm';
  codec: 'h264' | 'h265';
  resolution: 'keep' | '1080' | '720' | '480';
  stripAudio: boolean;
}
export const COMPRESS_DEFAULTS: CompressForm = {
  level: 'balanced',
  format: 'mp4',
  codec: 'h264',
  resolution: 'keep',
  stripAudio: false,
};

export function buildCompress(f: CompressForm): ToolOptions {
  const o = base(f.format, {
    quality: LEVEL_QUALITY[f.level],
    crf: LEVEL_CRF[f.level],
    stripAudio: f.stripAudio,
  });
  if (f.format !== 'webm') o.videoCodec = f.codec;
  if (f.resolution !== 'keep') o.height = Number(f.resolution);
  return o;
}

// --- video-trim ---------------------------------------------------------------------------------
export const TRIM_FORMATS = ['mp4', 'mov', 'webm'] as const;
export interface TrimForm {
  format: FormatChoice<(typeof TRIM_FORMATS)[number]>;
  start: number;
  end: number;
  reencode: boolean;
}
export const TRIM_DEFAULTS: TrimForm = { format: 'same', start: 0, end: 0, reencode: false };

export function trimRangeValid(start: number, end: number): boolean {
  const len = round2(end) - round2(start);
  return Number.isFinite(len) && start >= 0 && len >= TRIM_MIN_GAP - 1e-9 && len <= TRIM_MAX_SEC;
}

export function buildTrim(f: TrimForm, ctx?: ToolBuildContext): ToolOptions {
  return {
    mode: 'trim_video',
    format: resolveContainer(f.format, ctx, TRIM_FORMATS),
    startTime: round2(f.start),
    endTime: round2(f.end),
    copyMode: f.reencode ? 'reencode' : 'auto',
  };
}

// --- video-to-gif -------------------------------------------------------------------------------
export interface GifForm {
  /** 0/0 = whole clip. */
  start: number;
  end: number;
  width: number;
  fps: number;
  colors: number;
}
export const GIF_DEFAULTS: GifForm = { start: 0, end: 0, width: 480, fps: 12, colors: 128 };
export const GIF_WIDTHS = [320, 480, 640, 900] as const;
export const GIF_FPS = [8, 12, 15, 24] as const;
export const GIF_COLORS = [64, 128, 256] as const;
export const GIF_DEFAULT_SECONDS = 5;

export function buildGif(f: GifForm, ctx?: ToolBuildContext): ToolOptions {
  const o = base('gif', {
    gif: { width: f.width, fps: f.fps, colors: f.colors, delay: 3, optimize: 3 },
  });
  const dur = ctx?.file?.durationSec;
  const hasRange = f.end > f.start;
  const whole = hasRange && f.start <= 0.005 && dur !== undefined && f.end >= dur - 0.05;
  if (hasRange && !whole) o.trim = { startTime: round2(f.start), endTime: round2(f.end) };
  return o;
}

// --- video-extract-audio / video-remove-audio ---------------------------------------------------
export const AUDIO_EXTRACT_FORMATS = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'] as const;
export interface ExtractAudioForm {
  format: (typeof AUDIO_EXTRACT_FORMATS)[number];
}
export const EXTRACT_AUDIO_DEFAULTS: ExtractAudioForm = { format: 'mp3' };
export const buildExtractAudio = (f: ExtractAudioForm): ToolOptions => ({
  mode: 'extract_audio',
  format: f.format,
});

export interface RemoveAudioForm {
  format: 'mp4' | 'webm';
}
export const REMOVE_AUDIO_DEFAULTS: RemoveAudioForm = { format: 'mp4' };
export const buildRemoveAudio = (f: RemoveAudioForm): ToolOptions => ({
  mode: 'extract_video_only',
  format: f.format,
});

// --- video-extract-frames -----------------------------------------------------------------------
export type FrameMode = 'every_n_seconds' | 'fps' | 'timestamp';
export interface FramesForm {
  frameMode: FrameMode;
  intervalSeconds: number;
  fps: number;
  timestamps: number[];
  format: 'jpg' | 'png' | 'webp';
  maxFrames: number;
}
export const FRAMES_DEFAULTS: FramesForm = {
  frameMode: 'every_n_seconds',
  intervalSeconds: 5,
  fps: 1,
  timestamps: [],
  format: 'jpg',
  maxFrames: 300,
};

export function normalizeTimestamps(list: number[]): number[] {
  return [...new Set(list.filter((n) => Number.isFinite(n) && n >= 0).map(round2))].sort(
    (a, b) => a - b,
  );
}

export function framesValid(f: FramesForm): boolean {
  if (!Number.isInteger(f.maxFrames) || f.maxFrames < 1 || f.maxFrames > 1000) return false;
  if (f.frameMode === 'every_n_seconds')
    return f.intervalSeconds >= 0.1 && f.intervalSeconds <= 600;
  if (f.frameMode === 'fps') return f.fps >= 0.05 && f.fps <= 60;
  const n = normalizeTimestamps(f.timestamps).length;
  return n >= 1 && n <= f.maxFrames;
}

export function buildFrames(f: FramesForm): ToolOptions {
  const o: ToolOptions = {
    mode: 'extract_frames',
    frameMode: f.frameMode,
    format: f.format,
    maxFrames: f.maxFrames,
  };
  if (f.frameMode === 'every_n_seconds') o.intervalSeconds = f.intervalSeconds;
  else if (f.frameMode === 'fps') o.fps = f.fps;
  else o.timestamps = normalizeTimestamps(f.timestamps);
  return o;
}

// --- video-transform ----------------------------------------------------------------------------
export const TRANSFORM_FORMATS = ['mp4', 'webm', 'mov', 'mkv'] as const;
export type TransformOp = 'resize' | 'rotate' | 'crop';
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface TransformForm {
  op: TransformOp;
  format: FormatChoice<(typeof TRANSFORM_FORMATS)[number]>;
  width: number | null;
  height: number | null;
  keepAspect: boolean;
  rotation: 0 | 90 | 180 | 270;
  flipHorizontal: boolean;
  flipVertical: boolean;
  crop: CropRect | null;
}
export const TRANSFORM_DEFAULTS: TransformForm = {
  op: 'resize',
  format: 'same',
  width: null,
  height: null,
  keepAspect: true,
  rotation: 90,
  flipHorizontal: false,
  flipVertical: false,
  crop: null,
};

export function buildTransform(f: TransformForm, ctx?: ToolBuildContext): ToolOptions {
  const format = resolveContainer(f.format, ctx, TRANSFORM_FORMATS);
  const o = base(format, { preserveAspectRatio: f.op === 'resize' ? f.keepAspect : true });
  if (f.op === 'resize') {
    if (f.width) o.width = Math.round(f.width);
    if (f.height) o.height = Math.round(f.height);
  } else if (f.op === 'rotate') {
    o.transform = {
      rotation: f.rotation,
      flipHorizontal: f.flipHorizontal,
      flipVertical: f.flipVertical,
    };
  } else if (f.crop) {
    o.transform = {
      crop: {
        x: Math.round(f.crop.x),
        y: Math.round(f.crop.y),
        width: Math.round(f.crop.width),
        height: Math.round(f.crop.height),
      },
    };
  }
  return o;
}

const validSide = (n: number | null) =>
  n === null || (Number.isFinite(n) && n >= 1 && n <= MAX_SIDE);

/** True when the explicit `height` is over the cached tier cap (the only gated field, width is not). */
export function heightOverLimit(f: TransformForm, ctx?: ToolBuildContext): boolean {
  const cap = ctx?.limits?.maxOutputHeight;
  return f.op === 'resize' && !!f.height && cap !== undefined && cap > 0 && f.height > cap;
}

export function transformValid(f: TransformForm, ctx?: ToolBuildContext): boolean {
  if (f.op === 'resize') {
    if (!f.width && !f.height) return false;
    return validSide(f.width) && validSide(f.height) && !heightOverLimit(f, ctx);
  }
  if (f.op === 'crop') return !!f.crop && f.crop.width >= 1 && f.crop.height >= 1;
  return true;
}

// --- video-speed --------------------------------------------------------------------------------
export const SPEED_FORMATS = ['mp4', 'webm', 'mov', 'mkv', 'avi'] as const;
export const SPEED_CHIPS = [0.25, 0.5, 0.75, 1.25, 1.5, 2, 3, 4] as const;
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 4;
export interface SpeedForm {
  format: FormatChoice<(typeof SPEED_FORMATS)[number]>;
  speed: number;
  reverse: boolean;
}
export const SPEED_DEFAULTS: SpeedForm = { format: 'same', speed: 2, reverse: false };

export function buildSpeed(f: SpeedForm, ctx?: ToolBuildContext): ToolOptions {
  const o = base(resolveContainer(f.format, ctx, SPEED_FORMATS), { speed: f.speed });
  if (f.reverse) o.temporal = { reverse: true };
  return o;
}
export const speedValid = (f: SpeedForm) => f.speed >= SPEED_MIN && f.speed <= SPEED_MAX;

// --- video-adjust -------------------------------------------------------------------------------
export type AdjustOp = 'stabilize' | 'frameRate' | 'color';
export interface AdjustForm {
  adjust: AdjustOp;
  format: FormatChoice<(typeof SPEED_FORMATS)[number]>;
  shakiness: number;
  accuracy: number;
  target: number;
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  gamma: number;
}
export const ADJUST_DEFAULTS: AdjustForm = {
  adjust: 'stabilize',
  format: 'same',
  shakiness: 5,
  accuracy: 9,
  target: 30,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  hue: 0,
  gamma: 1,
};

export function colorEffects(f: AdjustForm): Record<string, number> {
  const out: Record<string, number> = {};
  if (f.brightness !== 0) out.brightness = Math.round(f.brightness);
  if (f.contrast !== 0) out.contrast = Math.round(f.contrast);
  if (f.saturation !== 0) out.saturation = Math.round(f.saturation);
  if (f.hue !== 0) out.hue = Math.round(f.hue);
  if (Math.abs(f.gamma - 1) > 1e-9) out.gamma = Math.round(f.gamma * 10) / 10;
  return out;
}

export function buildAdjust(f: AdjustForm, ctx?: ToolBuildContext): ToolOptions {
  const o = base(resolveContainer(f.format, ctx, SPEED_FORMATS));
  if (f.adjust === 'stabilize') {
    o.temporal = {
      stabilization: { enabled: true, shakiness: f.shakiness, accuracy: f.accuracy },
    };
  } else if (f.adjust === 'frameRate') {
    o.temporal = { frameRate: { target: f.target, interpolation: false } };
  } else {
    const fx = colorEffects(f);
    if (Object.keys(fx).length > 0) o.visualEffects = fx;
  }
  return o;
}

export function adjustValid(f: AdjustForm): boolean {
  if (f.adjust === 'color') return Object.keys(colorEffects(f)).length > 0;
  if (f.adjust === 'frameRate') return f.target >= 1 && f.target <= 120;
  return f.shakiness >= 1 && f.shakiness <= 10 && f.accuracy >= 1 && f.accuracy <= 15;
}

// --- analytics slugs (decision 9) ---------------------------------------------------------------
export const slugForConvert = (f: ConvertForm) =>
  f.codec === 'h265' ? 'convert-video-to-hevc' : 'video-converter';
export const slugForTransform = (f: TransformForm) => {
  if (f.op === 'crop') return 'crop-video';
  if (f.op === 'rotate') {
    return f.rotation === 0 && (f.flipHorizontal || f.flipVertical) ? 'flip-video' : 'rotate-video';
  }
  return 'resize-video';
};
export const slugForSpeed = (f: SpeedForm) => (f.reverse ? 'reverse-video' : 'change-video-speed');
export const slugForAdjust = (f: AdjustForm) =>
  f.adjust === 'frameRate'
    ? 'change-video-frame-rate'
    : f.adjust === 'color'
      ? 'adjust-video-color'
      : 'stabilize-video';
