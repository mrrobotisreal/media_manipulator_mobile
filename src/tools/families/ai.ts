import {
  BlurFacesForm,
  RedactTextForm,
  RemoveBackgroundForm,
  RemoveObjectForm,
  UpscaleForm,
} from '../forms/ai/ImageAiForms';
import {
  FrameInterpolationForm,
  StemForm,
  TranscribeForm,
  VoiceForm,
} from '../forms/ai/MediaAiForms';
import { ensureFreshDetection } from '../forms/ai/faceSession';
import { detectFaces, realDetectDeps } from '@/api/endpoints/ai';
import { EVENTS } from '@/analytics/events';
import { track } from '@/analytics/track';
import * as o from '../options/ai';
import type { AnyToolDefinition } from '../types';
import {
  AUDIO_ACCEPTS,
  IMAGE_ACCEPTS,
  VIDEO_ACCEPTS,
  audioBase,
  imageBase,
  mergeAccepts,
  row,
  videoBase,
} from './shared';

const seeded = [
  row({
    id: 'remove-background',
    family: 'ai',
    icon: 'Wand2',
    accepts: IMAGE_ACCEPTS,
    endpoint: 'upload',
    defaults: imageBase({ format: 'png', ai: { enabled: true, operation: 'remove_background' } }),
    metric: 'ops',
    analyticsSlug: 'remove-background-from-image',
    webTask: 'remove_background',
    resultHint: 'image',
    keywords: ['remove-background-from-image', 'cutout', 'transparent', 'background'],
  }),
  row({
    id: 'upscale',
    family: 'ai',
    icon: 'ImageUp',
    accepts: IMAGE_ACCEPTS,
    endpoint: 'upload',
    defaults: imageBase({
      format: 'png',
      ai: {
        enabled: true,
        operation: 'ai_upscale',
        upscaleScale: 2,
        upscaleModel: 'realesrgan-x4plus',
      },
    }),
    metric: 'ai_ops',
    analyticsSlug: 'ai-image-upscaler',
    webTask: 'image_converter',
    resultHint: 'image',
    keywords: ['ai-image-upscaler', 'enhance', 'bigger', 'sharper', 'hd'],
  }),
  row({
    id: 'blur-faces',
    family: 'ai',
    icon: 'ScanFace',
    accepts: IMAGE_ACCEPTS,
    endpoint: 'upload',
    defaults: imageBase({ ai: { enabled: true, operation: 'face_privacy', faceMode: 'blur' } }),
    metric: 'ai_ops',
    analyticsSlug: 'blur-faces-in-photo',
    webTask: 'image_converter',
    resultHint: 'image',
    keywords: ['blur-faces-in-photo', 'privacy', 'anonymize', 'pixelate'],
  }),
  row({
    id: 'redact-text',
    family: 'ai',
    icon: 'ScanText',
    accepts: IMAGE_ACCEPTS,
    endpoint: 'upload',
    defaults: imageBase({
      ai: { enabled: true, operation: 'redact_text', textDetect: 'pii', textRedaction: 'blackbox' },
    }),
    metric: 'ai_ops',
    analyticsSlug: 'redact-text-in-image',
    webTask: 'image_converter',
    resultHint: 'image',
    keywords: ['redact-text-in-image', 'privacy', 'censor', 'ocr', 'pii'],
  }),
  row({
    id: 'remove-object',
    family: 'ai',
    icon: 'Eraser',
    accepts: IMAGE_ACCEPTS,
    endpoint: 'upload',
    defaults: imageBase({ ai: { enabled: true, operation: 'remove_object' } }),
    metric: 'ai_ops',
    analyticsSlug: 'remove-object-from-photo',
    webTask: 'image_converter',
    resultHint: 'image',
    keywords: ['remove-object-from-photo', 'erase', 'inpaint', 'retouch'],
  }),
  row({
    id: 'clean-voice',
    family: 'ai',
    icon: 'Mic',
    accepts: AUDIO_ACCEPTS,
    endpoint: 'upload',
    defaults: audioBase({ ai: { enabled: true, operation: 'clean_voice' } }),
    metric: 'ops',
    analyticsSlug: 'clean-voice-audio',
    webTask: 'audio_converter',
    resultHint: 'audio',
    keywords: ['clean-voice-audio', 'speech', 'enhance', 'podcast'],
  }),
  row({
    id: 'remove-noise',
    family: 'ai',
    icon: 'Waves',
    accepts: AUDIO_ACCEPTS,
    endpoint: 'upload',
    defaults: audioBase({ ai: { enabled: true, operation: 'remove_background_noise' } }),
    metric: 'ops',
    analyticsSlug: 'remove-background-noise',
    webTask: 'audio_converter',
    resultHint: 'audio',
    keywords: ['remove-background-noise', 'denoise', 'hiss', 'hum'],
  }),
  row({
    id: 'isolate-vocals',
    family: 'ai',
    icon: 'Mic2',
    accepts: mergeAccepts(AUDIO_ACCEPTS, VIDEO_ACCEPTS),
    endpoint: 'auto',
    defaults: audioBase({ format: 'wav', ai: { enabled: true, operation: 'isolate_vocals' } }),
    metric: 'ai_ops',
    analyticsSlug: 'isolate-vocals-from-song',
    webTask: 'isolate_vocals',
    resultHint: 'audio',
    keywords: ['isolate-vocals-from-song', 'acapella', 'stem', 'singing'],
  }),
  row({
    id: 'remove-vocals',
    family: 'ai',
    icon: 'ListMusic',
    accepts: mergeAccepts(AUDIO_ACCEPTS, VIDEO_ACCEPTS),
    endpoint: 'auto',
    defaults: audioBase({ format: 'wav', ai: { enabled: true, operation: 'remove_vocals' } }),
    metric: 'ai_ops',
    analyticsSlug: 'remove-vocals-from-song',
    webTask: 'audio_converter',
    resultHint: 'audio',
    keywords: ['remove-vocals-from-song', 'instrumental', 'karaoke', 'backing'],
  }),
  row({
    id: 'frame-interpolation',
    family: 'ai',
    icon: 'Clapperboard',
    accepts: VIDEO_ACCEPTS,
    endpoint: 'presign',
    defaults: videoBase({
      ai: {
        enabled: true,
        operation: 'frame_interpolation',
        frameInterpolation: { targetFps: 60 },
      },
    }),
    metric: 'ai_ops',
    analyticsSlug: 'ai-frame-interpolation',
    webTask: 'ai_frame_interpolation',
    resultHint: 'video',
    keywords: ['ai-frame-interpolation', 'smooth', 'fps', 'slow-motion', 'interpolate'],
  }),
  row({
    id: 'transcribe',
    family: 'ai',
    icon: 'Captions',
    accepts: mergeAccepts(VIDEO_ACCEPTS, AUDIO_ACCEPTS),
    endpoint: 'auto',
    defaults: { mode: 'transcribe', format: 'vtt' },
    metric: 'ai_ops',
    analyticsSlug: 'transcribe-video',
    webTask: 'transcribe_video',
    resultHint: 'transcript',
    keywords: [
      'transcribe-video',
      'transcribe-audio',
      'srt-generator',
      'generate-vtt-captions',
      'subtitles',
      'captions',
      'speech-to-text',
      'srt',
      'vtt',
    ],
  }),
];

function byId(id: string): AnyToolDefinition {
  return seeded.find((t) => t.id === id)!;
}

/** Replaces the MA10 identity builder / DefaultsForm of a seeded row with the real form + builder. */
function withForm(base: AnyToolDefinition, extra: Partial<AnyToolDefinition>): AnyToolDefinition {
  return { ...base, ...extra };
}

const transcribePreset = (
  id: 'srt-generator' | 'generate-vtt-captions',
  format: o.TranscribeFormat,
) => ({
  id,
  titleKey: `interface:transcribeForm.format.${format}.label`,
  analyticsSlug: id,
  defaults: { format, slugHint: id } as Partial<o.TranscribeForm>,
});

/**
 * The eleven AI tools (MA20). All run on the GPU server; metric per `quota_metric.go`
 * (remove-background, clean-voice, remove-noise spend `ops`; the rest `ai_ops`).
 */
export const aiTools: AnyToolDefinition[] = [
  withForm(byId('remove-background'), {
    Form: RemoveBackgroundForm,
    defaults: o.removeBackgroundDefaults,
    optionsBuilder: o.buildRemoveBackgroundOptions,
  }),
  withForm(byId('upscale'), {
    Form: UpscaleForm,
    defaults: o.upscaleDefaults,
    optionsBuilder: o.buildUpscaleOptions,
  }),
  withForm(byId('blur-faces'), {
    Form: BlurFacesForm,
    defaults: o.blurFacesDefaults,
    optionsBuilder: o.buildBlurFacesOptions,
    blockReason: o.blurFacesBlockReason,
    // Session expired (30 min) -> detect again from the same cached file before upload.
    prepare: (form, ctx) =>
      ensureFreshDetection(form, ctx, (f) => detectFaces(f, realDetectDeps())),
  }),
  withForm(byId('redact-text'), {
    Form: RedactTextForm,
    defaults: o.redactTextDefaults,
    optionsBuilder: o.buildRedactTextOptions,
  }),
  withForm(byId('remove-object'), {
    Form: RemoveObjectForm,
    defaults: o.removeObjectDefaults,
    optionsBuilder: o.buildRemoveObjectOptions,
    blockReason: o.removeObjectBlockReason,
    // Catalog: feature_used {feature:'remove_object', action:'rects', value: count} at Run.
    prepare: async (form: o.RemoveObjectForm) => {
      track(EVENTS.FEATURE_USED, {
        feature: 'remove_object',
        action: 'rects',
        value: form.rects.length,
      });
      return form;
    },
  }),
  withForm(byId('clean-voice'), {
    Form: VoiceForm,
    defaults: {},
    optionsBuilder: (_f: unknown, ctx) => o.buildVoiceOptions('clean_voice', ctx),
  }),
  withForm(byId('remove-noise'), {
    Form: VoiceForm,
    defaults: {},
    optionsBuilder: (_f: unknown, ctx) => o.buildVoiceOptions('remove_background_noise', ctx),
  }),
  withForm(byId('isolate-vocals'), {
    Form: StemForm,
    defaults: o.stemDefaults,
    optionsBuilder: (f: o.StemForm, ctx) => o.buildStemOptions('isolate_vocals', f, ctx),
  }),
  withForm(byId('remove-vocals'), {
    Form: StemForm,
    defaults: o.stemDefaults,
    optionsBuilder: (f: o.StemForm, ctx) => o.buildStemOptions('remove_vocals', f, ctx),
  }),
  withForm(byId('frame-interpolation'), {
    Form: FrameInterpolationForm,
    defaults: o.frameInterpolationDefaults,
    optionsBuilder: o.buildFrameInterpolationOptions,
    blockReason: o.frameInterpolationBlockReason,
    serverLimits: {
      maxSeconds: o.INTERP_SERVER_LIMITS.maxSeconds,
      maxHeight: o.INTERP_SERVER_LIMITS.maxHeight,
    },
  }),
  withForm(byId('transcribe'), {
    Form: TranscribeForm,
    defaults: o.transcribeDefaults,
    optionsBuilder: o.buildTranscribeOptions,
    blockReason: o.transcribeBlockReason,
    analyticsSlugFor: o.transcribeSlug,
    presets: [
      transcribePreset('srt-generator', 'srt'),
      transcribePreset('generate-vtt-captions', 'vtt'),
    ],
  }),
];
