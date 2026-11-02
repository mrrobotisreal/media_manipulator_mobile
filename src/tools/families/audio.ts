import type { AnyToolDefinition, ToolAccepts, ToolPreset } from '../types';
import {
  audioConvertDefaults,
  audioConvertSlug,
  audioEffectsDefaults,
  audioEffectsSlug,
  audioTrimDefaults,
  audioWaveformDefaults,
  buildAudioConvert,
  buildAudioEffects,
  buildAudioTrim,
  buildAudioWaveform,
  type AudioConvertForm,
  type AudioEffectsForm,
  type AudioTrimForm,
  type AudioWaveformForm,
} from '../options/audio';
import { AudioConvertForm as ConvertFormView } from '../forms/audio/AudioConvertForm';
import { AudioEffectsForm as EffectsFormView } from '../forms/audio/AudioEffectsForm';
import { AudioTrimForm as TrimFormView } from '../forms/audio/AudioTrimForm';
import { AudioWaveformForm as WaveformFormView } from '../forms/audio/AudioWaveformForm';
import { row } from './shared';

/** Audio-only input for the audio family (ticket decision 1; a video file would hit the video path). */
const AUDIO_TOOL_ACCEPTS: ToolAccepts = {
  kinds: ['audio'],
  mime: [
    'audio/mpeg',
    'audio/wav',
    'audio/x-wav',
    'audio/aac',
    'audio/mp4',
    'audio/x-m4a',
    'audio/ogg',
    'audio/flac',
    'audio/opus',
    'audio/ac3',
    'audio/aiff',
    'audio/x-aiff',
    'audio/x-caf',
  ],
  extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'ac3', 'dts', 'aiff', 'caf'],
};

const a = (
  r: Parameters<typeof row>[0] extends infer R
    ? Omit<R & object, 'family' | 'accepts' | 'endpoint' | 'metric'>
    : never,
) => row({ ...r, family: 'audio', accepts: AUDIO_TOOL_ACCEPTS, endpoint: 'upload', metric: 'ops' });

const convertPresets: ToolPreset<AudioConvertForm>[] = [
  {
    id: 'wav',
    titleKey: 'tools.items.audio-convert.title',
    analyticsSlug: 'convert-audio-to-wav',
    defaults: { format: 'wav' },
  },
  {
    id: 'flac',
    titleKey: 'tools.items.audio-convert.title',
    analyticsSlug: 'convert-audio-to-flac',
    defaults: { format: 'flac' },
  },
  {
    id: 'ogg',
    titleKey: 'tools.items.audio-convert.title',
    analyticsSlug: 'convert-audio-to-ogg',
    defaults: { format: 'ogg' },
  },
  {
    id: 'm4a',
    titleKey: 'tools.items.audio-convert.title',
    analyticsSlug: 'convert-audio-to-m4a',
    defaults: { format: 'aac' },
  },
  {
    id: 'opus',
    titleKey: 'tools.items.audio-convert.title',
    analyticsSlug: 'convert-audio-to-opus',
    defaults: { format: 'opus' },
  },
  {
    id: 'wav-to-mp3',
    titleKey: 'tools.items.audio-convert.title',
    analyticsSlug: 'convert-wav-to-mp3',
    defaults: { format: 'mp3' },
  },
  {
    id: 'mp3-to-wav',
    titleKey: 'tools.items.audio-convert.title',
    analyticsSlug: 'convert-mp3-to-wav',
    defaults: { format: 'wav' },
  },
];

const effectsPresets: ToolPreset<AudioEffectsForm>[] = [
  {
    id: 'speed',
    titleKey: 'tools.audio.effects.speed',
    analyticsSlug: 'change-audio-speed',
    defaults: { effects: ['speed'], speed: 1.5 },
  },
  {
    id: 'pitch',
    titleKey: 'tools.audio.effects.pitch',
    analyticsSlug: 'change-audio-pitch',
    defaults: { effects: ['pitch'], pitch: 2 },
  },
  {
    id: 'normalize',
    titleKey: 'tools.audio.effects.normalize',
    analyticsSlug: 'normalize-audio',
    defaults: { effects: ['normalize'] },
  },
  {
    id: 'volume',
    titleKey: 'tools.audio.effects.volume',
    analyticsSlug: 'adjust-audio-volume',
    defaults: { effects: ['volume'], volume: 1.5 },
  },
  {
    id: 'eq',
    titleKey: 'tools.audio.effects.eq',
    analyticsSlug: 'audio-equalizer',
    defaults: { effects: ['eq'], eq: 'bass-boost' },
  },
  {
    id: 'reverb',
    titleKey: 'tools.audio.effects.reverb',
    analyticsSlug: 'add-reverb-to-audio',
    defaults: { effects: ['reverb'], reverb: 'hall' },
  },
];

const convert: AnyToolDefinition = {
  ...a({
    id: 'audio-convert',
    icon: 'Music',
    defaults: audioConvertDefaults,
    analyticsSlug: 'audio-converter',
    webTask: 'audio_converter',
    resultHint: 'audio',
    keywords: [
      'audio-converter',
      'convert-audio-to-mp3',
      'convert-wav-to-mp3',
      'convert-mp3-to-wav',
      'mp3',
      'wav',
      'flac',
      'aac',
    ],
  }),
  Form: ConvertFormView,
  optionsBuilder: (f: AudioConvertForm) => buildAudioConvert(f),
  analyticsSlugFor: (f: AudioConvertForm, ctx) => audioConvertSlug(f, ctx?.input?.extension),
  presets: convertPresets,
};

const trim: AnyToolDefinition = {
  ...a({
    id: 'audio-trim',
    icon: 'Scissors',
    defaults: audioTrimDefaults,
    analyticsSlug: 'trim-audio',
    webTask: 'trim_audio',
    resultHint: 'audio',
    keywords: ['trim-audio', 'cut', 'clip'],
  }),
  Form: TrimFormView,
  optionsBuilder: (f: AudioTrimForm, ctx) => buildAudioTrim(f, ctx?.input?.extension),
};

const effects: AnyToolDefinition = {
  ...a({
    id: 'audio-effects',
    icon: 'Sliders',
    defaults: audioEffectsDefaults,
    analyticsSlug: 'change-audio-speed',
    webTask: 'change_audio_speed',
    resultHint: 'audio',
    keywords: [
      'change-audio-speed',
      'change-audio-pitch',
      'normalize-audio',
      'adjust-audio-volume',
      'audio-equalizer',
      'add-reverb-to-audio',
      'pitch',
      'volume',
      'reverb',
    ],
  }),
  Form: EffectsFormView,
  optionsBuilder: (f: AudioEffectsForm, ctx) => buildAudioEffects(f, ctx?.input?.extension),
  analyticsSlugFor: (f: AudioEffectsForm) => audioEffectsSlug(f),
  blockReason: (f: AudioEffectsForm) => (f.effects.length > 0 ? null : 'no_effect'),
  presets: effectsPresets,
};

const waveform: AnyToolDefinition = {
  ...a({
    id: 'audio-waveform',
    icon: 'AudioWaveform',
    defaults: audioWaveformDefaults,
    analyticsSlug: 'audio-waveform-generator',
    webTask: 'audio_waveform',
    resultHint: 'video',
    keywords: ['audio-waveform-generator', 'visualizer', 'sound-wave'],
  }),
  Form: WaveformFormView,
  optionsBuilder: (f: AudioWaveformForm) => buildAudioWaveform(f),
};

export const audioTools = [convert, trim, effects, waveform];
