import { VideoAdjustForm } from '../forms/video/AdjustForm';
import { VideoExtractAudioForm, VideoRemoveAudioForm } from '../forms/video/AudioForms';
import { VideoCompressForm } from '../forms/video/CompressForm';
import { VideoConvertForm } from '../forms/video/ConvertForm';
import { VideoExtractFramesForm } from '../forms/video/FramesForm';
import { VideoToGifForm } from '../forms/video/GifForm';
import { VideoSpeedForm } from '../forms/video/SpeedForm';
import { VideoTransformForm } from '../forms/video/TransformForm';
import { VideoTrimForm } from '../forms/video/TrimForm';
import {
  ADJUST_DEFAULTS,
  COMPRESS_DEFAULTS,
  CONVERT_DEFAULTS,
  EXTRACT_AUDIO_DEFAULTS,
  FRAMES_DEFAULTS,
  GIF_DEFAULTS,
  REMOVE_AUDIO_DEFAULTS,
  SPEED_DEFAULTS,
  TRANSFORM_DEFAULTS,
  TRIM_DEFAULTS,
  adjustValid,
  buildAdjust,
  buildCompress,
  buildConvert,
  buildExtractAudio,
  buildFrames,
  buildGif,
  buildRemoveAudio,
  buildSpeed,
  buildTransform,
  buildTrim,
  framesValid,
  slugForAdjust,
  slugForConvert,
  slugForSpeed,
  slugForTransform,
  speedValid,
  transformValid,
  trimRangeValid,
} from '../options/video';
import type { AnyToolDefinition, ToolOptions, ToolPreset } from '../types';
import { VIDEO_ACCEPTS, row } from './shared';

type RowArgs = Omit<Parameters<typeof row>[0], 'family' | 'accepts' | 'endpoint' | 'metric'>;

/** Typed form defaults as the registry's erased options record. */
const d = (x: object) => x as ToolOptions;

const v = (r: RowArgs, extra: Partial<AnyToolDefinition>): AnyToolDefinition => ({
  ...row({ ...r, family: 'video', accepts: VIDEO_ACCEPTS, endpoint: 'presign', metric: 'ops' }),
  ...extra,
});

/** A folded web slug: same title as the tool, its own analytics slug, defaults laid over the form. */
const ALIAS_OF: Record<string, string> = {
  'mp4-converter': 'video-converter',
  'mp4-trimmer': 'video-trimmer',
  'video-cutter': 'video-trimmer',
  'cut-video-online': 'video-trimmer',
  'video-to-gif': 'convert-video-to-animated-gif',
  'mp4-to-gif': 'convert-video-to-animated-gif',
  'gif-converter': 'convert-video-to-animated-gif',
  'video-compressor': 'compress-video',
  'compress-mp4': 'compress-video',
  'video-to-mp3': 'extract-audio-from-video',
  'mp4-to-mp3': 'extract-audio-from-video',
};

/** Web aliases keep their own preset id but report the canonical slug (aliases are never event slugs). */
const preset = (
  toolId: string,
  webSlug: string,
  defaults: Record<string, unknown> = {},
): ToolPreset<any> => ({
  id: webSlug,
  titleKey: `tools.items.${toolId}.title`,
  analyticsSlug: ALIAS_OF[webSlug] ?? webSlug,
  defaults,
});

export const videoTools: AnyToolDefinition[] = [
  v(
    {
      id: 'video-convert',
      icon: 'Film',
      defaults: d(CONVERT_DEFAULTS),
      analyticsSlug: 'video-converter',
      webTask: 'video_converter',
      resultHint: 'video',
      keywords: [
        'video-converter',
        'mp4-converter',
        'convert-mov-to-mp4',
        'convert-webm-to-mp4',
        'convert-avi-to-mp4',
        'convert-mkv-to-mp4',
        'convert-mp4-to-webm',
        'convert-video-to-hevc',
        'mp4',
        'mov',
        'webm',
        'mkv',
      ],
    },
    {
      Form: VideoConvertForm,
      optionsBuilder: buildConvert,
      analyticsSlugFor: slugForConvert,
      presets: [
        preset('video-convert', 'video-converter'),
        preset('video-convert', 'mp4-converter', { format: 'mp4' }),
        preset('video-convert', 'convert-mov-to-mp4', { format: 'mp4' }),
        preset('video-convert', 'convert-webm-to-mp4', { format: 'mp4' }),
        preset('video-convert', 'convert-avi-to-mp4', { format: 'mp4' }),
        preset('video-convert', 'convert-mkv-to-mp4', { format: 'mp4' }),
        preset('video-convert', 'convert-mp4-to-webm', { format: 'webm' }),
        preset('video-convert', 'convert-video-to-hevc', { format: 'mp4', codec: 'h265' }),
      ],
    },
  ),
  v(
    {
      id: 'video-compress',
      icon: 'Minimize2',
      defaults: d(COMPRESS_DEFAULTS),
      analyticsSlug: 'compress-video',
      webTask: 'compress_video',
      resultHint: 'video',
      keywords: ['compress-video', 'video-compressor', 'compress-mp4', 'smaller', 'shrink'],
    },
    {
      Form: VideoCompressForm,
      optionsBuilder: buildCompress,
      presets: [
        preset('video-compress', 'compress-video'),
        preset('video-compress', 'video-compressor'),
        preset('video-compress', 'compress-mp4', { format: 'mp4' }),
      ],
    },
  ),
  v(
    {
      id: 'video-trim',
      icon: 'Scissors',
      defaults: d(TRIM_DEFAULTS),
      analyticsSlug: 'video-trimmer',
      webTask: 'video_trimmer',
      resultHint: 'video',
      keywords: ['video-trimmer', 'mp4-trimmer', 'video-cutter', 'cut-video-online', 'cut', 'clip'],
    },
    {
      Form: VideoTrimForm,
      optionsBuilder: buildTrim,
      isValid: (f, ctx) =>
        trimRangeValid(f.start, f.end) &&
        (!ctx?.file?.durationSec || f.end <= ctx.file.durationSec + 0.5),
      presets: [
        preset('video-trim', 'video-trimmer'),
        preset('video-trim', 'mp4-trimmer'),
        preset('video-trim', 'video-cutter'),
        preset('video-trim', 'cut-video-online'),
      ],
    },
  ),
  v(
    {
      id: 'video-to-gif',
      icon: 'Images',
      defaults: d(GIF_DEFAULTS),
      analyticsSlug: 'convert-video-to-animated-gif',
      webTask: 'video_to_gif',
      resultHint: 'gif',
      keywords: [
        'convert-video-to-animated-gif',
        'video-to-gif',
        'mp4-to-gif',
        'gif-converter',
        'gif',
        'animated',
      ],
    },
    {
      Form: VideoToGifForm,
      optionsBuilder: buildGif,
      isValid: (f) => f.end === 0 || f.end - f.start >= 0.1,
      presets: [
        preset('video-to-gif', 'convert-video-to-animated-gif'),
        preset('video-to-gif', 'video-to-gif'),
        preset('video-to-gif', 'mp4-to-gif'),
        preset('video-to-gif', 'gif-converter'),
      ],
    },
  ),
  v(
    {
      id: 'video-extract-audio',
      icon: 'AudioLines',
      defaults: d(EXTRACT_AUDIO_DEFAULTS),
      analyticsSlug: 'extract-audio-from-video',
      webTask: 'extract_audio',
      resultHint: 'audio',
      keywords: ['extract-audio-from-video', 'mp4-to-mp3', 'video-to-mp3', 'mp3', 'sound'],
    },
    {
      Form: VideoExtractAudioForm,
      optionsBuilder: buildExtractAudio,
      presets: [
        preset('video-extract-audio', 'extract-audio-from-video'),
        preset('video-extract-audio', 'video-to-mp3', { format: 'mp3' }),
        preset('video-extract-audio', 'mp4-to-mp3', { format: 'mp3' }),
      ],
    },
  ),
  v(
    {
      id: 'video-remove-audio',
      icon: 'VolumeX',
      defaults: d(REMOVE_AUDIO_DEFAULTS),
      analyticsSlug: 'remove-audio-from-video',
      webTask: 'remove_audio_from_video',
      resultHint: 'video',
      keywords: ['remove-audio-from-video', 'extract-video-only-from-video', 'mute', 'silent'],
    },
    {
      Form: VideoRemoveAudioForm,
      optionsBuilder: buildRemoveAudio,
      presets: [
        preset('video-remove-audio', 'remove-audio-from-video'),
        preset('video-remove-audio', 'extract-video-only-from-video'),
      ],
    },
  ),
  v(
    {
      id: 'video-extract-frames',
      icon: 'LayoutGrid',
      defaults: d(FRAMES_DEFAULTS),
      analyticsSlug: 'extract-frames-from-video',
      webTask: 'extract_frames',
      resultHint: 'archive',
      keywords: ['extract-frames-from-video', 'screenshot', 'thumbnail', 'stills'],
    },
    {
      Form: VideoExtractFramesForm,
      optionsBuilder: buildFrames,
      isValid: framesValid,
      presets: [preset('video-extract-frames', 'extract-frames-from-video')],
    },
  ),
  v(
    {
      id: 'video-transform',
      icon: 'Move',
      defaults: d(TRANSFORM_DEFAULTS),
      analyticsSlug: 'resize-video',
      webTask: 'crop_video',
      resultHint: 'video',
      keywords: ['crop-video', 'resize-video', 'rotate-video', 'flip-video', 'mirror'],
    },
    {
      Form: VideoTransformForm,
      optionsBuilder: buildTransform,
      isValid: transformValid,
      analyticsSlugFor: slugForTransform,
      presets: [
        preset('video-transform', 'resize-video', { op: 'resize' }),
        preset('video-transform', 'rotate-video', { op: 'rotate', rotation: 90 }),
        preset('video-transform', 'flip-video', {
          op: 'rotate',
          rotation: 0,
          flipHorizontal: true,
        }),
        preset('video-transform', 'crop-video', { op: 'crop' }),
      ],
    },
  ),
  v(
    {
      id: 'video-speed',
      icon: 'Gauge',
      defaults: d(SPEED_DEFAULTS),
      analyticsSlug: 'change-video-speed',
      webTask: 'change_video_speed',
      resultHint: 'video',
      keywords: ['change-video-speed', 'reverse-video', 'slow', 'fast', 'motion'],
    },
    {
      Form: VideoSpeedForm,
      optionsBuilder: buildSpeed,
      isValid: speedValid,
      analyticsSlugFor: slugForSpeed,
      presets: [
        preset('video-speed', 'change-video-speed', { speed: 2 }),
        preset('video-speed', 'reverse-video', { speed: 1, reverse: true }),
      ],
    },
  ),
  v(
    {
      id: 'video-adjust',
      icon: 'SlidersHorizontal',
      defaults: d(ADJUST_DEFAULTS),
      analyticsSlug: 'stabilize-video',
      webTask: 'stabilize_video',
      resultHint: 'video',
      keywords: [
        'stabilize-video',
        'change-video-frame-rate',
        'adjust-video-color',
        'fps',
        'brightness',
        'contrast',
      ],
    },
    {
      Form: VideoAdjustForm,
      optionsBuilder: buildAdjust,
      isValid: adjustValid,
      analyticsSlugFor: slugForAdjust,
      presets: [
        preset('video-adjust', 'stabilize-video', { adjust: 'stabilize' }),
        preset('video-adjust', 'change-video-frame-rate', { adjust: 'frameRate', target: 30 }),
        preset('video-adjust', 'adjust-video-color', { adjust: 'color' }),
      ],
    },
  ),
];
