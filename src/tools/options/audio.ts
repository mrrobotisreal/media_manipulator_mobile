import type { ToolOptions } from '../types';

/** Fields `validateAudioOptions` requires on every non-mode audio job (web defaults). */
export const AUDIO_BASE = {
  bitrate: '192',
  sampleRate: '44100',
  channels: 'stereo',
  speed: 1,
  volume: 1,
} as const;

export const AUDIO_FORMATS = ['mp3', 'wav', 'aac', 'ogg', 'flac', 'alac', 'opus'] as const;
export type AudioFormat = (typeof AUDIO_FORMATS)[number];
/** Formats whose output honours a bitrate (the rest are lossless). */
export const LOSSY_FORMATS: readonly AudioFormat[] = ['mp3', 'aac', 'ogg', 'opus'];
export const hasBitrate = (f: AudioFormat) => LOSSY_FORMATS.includes(f);

export const BITRATES = ['128', '192', '256', '320'] as const;
export const SAMPLE_RATES = ['44100', '48000'] as const;
export const CHANNELS = ['mono', 'stereo'] as const;

/** "Same as original" (proposed, ticket decision 4): input extension -> API output format. */
export function sameAsOriginalFormat(extension: string | undefined): AudioFormat {
  const e = (extension ?? '').toLowerCase();
  if (e === 'mp3' || e === 'wav' || e === 'flac' || e === 'ogg' || e === 'opus') return e;
  if (e === 'm4a' || e === 'aac') return 'aac';
  return 'mp3';
}

export type FormatChoice = AudioFormat | 'same';
const resolveFormat = (f: FormatChoice, ext?: string): AudioFormat =>
  f === 'same' ? sameAsOriginalFormat(ext) : f;

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- convert

export type AudioConvertForm = {
  format: AudioFormat;
  bitrate: (typeof BITRATES)[number];
  sampleRate: (typeof SAMPLE_RATES)[number];
  channels: (typeof CHANNELS)[number];
};
export const audioConvertDefaults: AudioConvertForm = {
  format: 'mp3',
  bitrate: '192',
  sampleRate: '44100',
  channels: 'stereo',
};

export function buildAudioConvert(form: AudioConvertForm): ToolOptions {
  return {
    ...AUDIO_BASE,
    format: form.format,
    bitrate: form.bitrate,
    sampleRate: form.sampleRate,
    channels: form.channels,
  };
}

/** Per-format web slug for the convert page the user effectively used. */
export function audioConvertSlug(form: AudioConvertForm, extension?: string): string {
  switch (form.format) {
    case 'wav':
      return 'convert-audio-to-wav';
    case 'flac':
      return 'convert-audio-to-flac';
    case 'ogg':
      return 'convert-audio-to-ogg';
    case 'aac':
      return 'convert-audio-to-m4a';
    case 'opus':
      return 'convert-audio-to-opus';
    case 'mp3':
      return extension?.toLowerCase() === 'wav' ? 'convert-wav-to-mp3' : 'audio-converter';
    default:
      return 'audio-converter';
  }
}

// ---------------------------------------------------------------- trim

export type AudioTrimForm = {
  format: FormatChoice;
  startTime: number;
  endTime: number;
  fadeIn: number;
  fadeOut: number;
};
export const audioTrimDefaults: AudioTrimForm = {
  format: 'same',
  startTime: 0,
  endTime: 30,
  fadeIn: 0,
  fadeOut: 0,
};
export const MIN_TRIM_GAP = 0.1;
export const MAX_FADE = 30;

export function buildAudioTrim(form: AudioTrimForm, extension?: string): ToolOptions {
  const startTime = round2(Math.max(0, form.startTime));
  const endTime = round2(Math.max(round2(startTime + MIN_TRIM_GAP), form.endTime));
  const out: ToolOptions = {
    ...AUDIO_BASE,
    format: resolveFormat(form.format, extension),
    trim: { startTime, endTime },
  };
  const basic: Record<string, number> = {};
  if (form.fadeIn > 0) basic.fadeIn = Math.min(MAX_FADE, form.fadeIn);
  if (form.fadeOut > 0) basic.fadeOut = Math.min(MAX_FADE, form.fadeOut);
  if (Object.keys(basic).length > 0) out.basicProcessing = basic;
  return out;
}

// ---------------------------------------------------------------- effects

export const AUDIO_EFFECTS = ['speed', 'pitch', 'normalize', 'volume', 'eq', 'reverb'] as const;
export type AudioEffect = (typeof AUDIO_EFFECTS)[number];
export const EQ_PRESETS = [
  'bass-boost',
  'treble-boost',
  'vocal',
  'classical',
  'rock',
  'jazz',
] as const;
export const REVERB_TYPES = ['room', 'hall', 'plate', 'spring'] as const;

export type AudioEffectsForm = {
  format: FormatChoice;
  effects: AudioEffect[];
  speed: number;
  volume: number;
  pitch: number;
  eq: (typeof EQ_PRESETS)[number];
  reverb: (typeof REVERB_TYPES)[number];
};
export const audioEffectsDefaults: AudioEffectsForm = {
  format: 'same',
  effects: ['speed'],
  speed: 1.5,
  volume: 1.5,
  pitch: 2,
  eq: 'bass-boost',
  reverb: 'hall',
};
/** Speed floor 0.5 (single atempo stage); the schema allows 0.25-4. */
export const SPEED_RANGE = { min: 0.5, max: 2, step: 0.05 } as const;
export const VOLUME_RANGE = { min: 0.1, max: 2, step: 0.05 } as const;
export const PITCH_RANGE = { min: -12, max: 12, step: 1 } as const;

export function buildAudioEffects(form: AudioEffectsForm, extension?: string): ToolOptions {
  const has = (e: AudioEffect) => form.effects.includes(e);
  const out: ToolOptions = {
    ...AUDIO_BASE,
    format: resolveFormat(form.format, extension),
    speed: has('speed') ? round2(form.speed) : 1,
    volume: has('volume') ? round2(form.volume) : 1,
  };
  const basic: Record<string, unknown> = {};
  if (has('normalize')) basic.normalize = true;
  if (has('eq')) basic.equalizer = { enabled: true, preset: form.eq };
  if (Object.keys(basic).length > 0) out.basicProcessing = basic;
  if (has('reverb')) {
    out.timeBasedEffects = {
      reverb: {
        enabled: true,
        type: form.reverb,
        roomSize: 50,
        damping: 50,
        wetLevel: 30,
        dryLevel: 70,
      },
    };
  }
  if (has('pitch')) {
    out.advanced = {
      pitchShift: { enabled: true, semitones: form.pitch, preserveFormants: true },
    };
  }
  return out;
}

const EFFECT_SLUG: Record<AudioEffect, string> = {
  speed: 'change-audio-speed',
  pitch: 'change-audio-pitch',
  normalize: 'normalize-audio',
  volume: 'adjust-audio-volume',
  eq: 'audio-equalizer',
  reverb: 'add-reverb-to-audio',
};
export function audioEffectsSlug(form: AudioEffectsForm): string {
  const first = AUDIO_EFFECTS.find((e) => form.effects.includes(e));
  return first ? EFFECT_SLUG[first] : 'change-audio-speed';
}

// ---------------------------------------------------------------- waveform

export type WaveformOutput = 'video' | 'image' | 'both';
export type WaveformMode = 'point' | 'line' | 'p2p' | 'cline';
export type WaveformScale = 'lin' | 'log' | 'sqrt' | 'cbrt';
export type WaveformDraw = 'scale' | 'full';

export type SizeQualifier = 'small' | 'medium' | 'large' | 'xl';
export interface WaveformSize {
  id: string;
  ratio: string;
  qualifier: SizeQualifier;
  width: number;
  height: number;
}
/** Web `PRESETS` (audio-waveform-panel.tsx), flattened. */
export const WAVEFORM_SIZES: readonly WaveformSize[] = (
  [
    [
      '10x1',
      [
        [1000, 100],
        [1600, 160],
        [2400, 240],
        [3840, 384],
      ],
    ],
    [
      '8x1',
      [
        [1024, 128],
        [1600, 200],
        [2400, 300],
        [3200, 400],
      ],
    ],
    [
      '6x1',
      [
        [960, 160],
        [1440, 240],
        [2160, 360],
        [2880, 480],
      ],
    ],
    [
      '16x9',
      [
        [1280, 720],
        [1920, 1080],
        [2560, 1440],
        [3840, 2160],
      ],
    ],
    [
      '1x1',
      [
        [720, 720],
        [1080, 1080],
        [1440, 1440],
        [2160, 2160],
      ],
    ],
  ] as const
).flatMap(([ratio, dims]) =>
  dims.map(([width, height], i) => {
    const qualifier = (['small', 'medium', 'large', 'xl'] as const)[i]!;
    return { id: `${qualifier}-${ratio}`, ratio, qualifier, width, height };
  }),
);
export const WAVEFORM_RATIOS = ['10x1', '8x1', '6x1', '16x9', '1x1'] as const;
export const WAVEFORM_DIM = { min: 64, max: 7680 } as const;
export const WAVEFORM_RATE = { min: 1, max: 120 } as const;
export const WAVEFORM_MODES: readonly WaveformMode[] = ['point', 'line', 'p2p', 'cline'];
export const WAVEFORM_SCALES: readonly WaveformScale[] = ['lin', 'log', 'sqrt', 'cbrt'];
export const WAVEFORM_DRAWS: readonly WaveformDraw[] = ['scale', 'full'];

export const WAVEFORM_PRIMARY = '#22D3EE';
export const WAVEFORM_SECONDARY = '#A855F7';
/** Colour swatches: the two web defaults plus a shared neutral/vivid set. */
export const WAVEFORM_SWATCHES: readonly string[] = [
  WAVEFORM_PRIMARY,
  WAVEFORM_SECONDARY,
  '#FFFFFF',
  '#F43F5E',
  '#F59E0B',
  '#22C55E',
  '#3B82F6',
  '#EC4899',
];

export type AudioWaveformForm = {
  output: WaveformOutput;
  /** A `WAVEFORM_SIZES` id, or 'custom' (then customWidth/customHeight). */
  sizeId: string;
  customWidth: string;
  customHeight: string;
  mode: WaveformMode;
  colorPrimary: string;
  colorSecondary: string;
  splitChannels: boolean;
  includeAudio: boolean;
  videoFormat: 'mp4' | 'webm';
  imageFormat: 'png' | 'webp';
  rate: number;
  scale: WaveformScale;
  draw: WaveformDraw;
};
export const audioWaveformDefaults: AudioWaveformForm = {
  output: 'video',
  sizeId: 'medium-10x1',
  customWidth: '1600',
  customHeight: '160',
  mode: 'point',
  colorPrimary: WAVEFORM_PRIMARY,
  colorSecondary: WAVEFORM_SECONDARY,
  splitChannels: false,
  includeAudio: true,
  videoFormat: 'mp4',
  imageFormat: 'png',
  rate: 25,
  scale: 'lin',
  draw: 'scale',
};

const even = (n: number) => (n % 2 === 0 ? n : n + 1);
const dim = (raw: string, fallback: number) => {
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n > 0
    ? Math.min(WAVEFORM_DIM.max, Math.max(WAVEFORM_DIM.min, n))
    : fallback;
};

export function resolveWaveformSize(form: AudioWaveformForm): { width: number; height: number } {
  if (form.sizeId === 'custom')
    return { width: even(dim(form.customWidth, 1600)), height: even(dim(form.customHeight, 160)) };
  const s = WAVEFORM_SIZES.find((x) => x.id === form.sizeId) ?? WAVEFORM_SIZES[1]!;
  return { width: s.width, height: s.height };
}

/** Key order matches the web panel's `buildAndSubmit` so the default payload is byte-equal. */
export function buildAudioWaveform(form: AudioWaveformForm): ToolOptions {
  const { width, height } = resolveWaveformSize(form);
  const rate = Math.min(WAVEFORM_RATE.max, Math.max(WAVEFORM_RATE.min, Math.round(form.rate)));
  return {
    mode: 'audio_waveform',
    waveform: {
      outputSelection: form.output,
      videoFormat: form.videoFormat,
      imageFormat: form.imageFormat,
      width,
      height,
      mode: form.mode,
      splitChannels: form.splitChannels,
      colorPrimary: form.colorPrimary,
      colorSecondary: form.colorSecondary,
      scale: form.scale,
      draw: form.draw,
      includeAudio: form.output !== 'image' ? form.includeAudio : false,
      rate,
    },
  };
}

/** True when the requested output height is over a plan cap (`<= 0` or undefined = no cap). */
export const overHeightLimit = (height: number, maxOutputHeight?: number) =>
  maxOutputHeight !== undefined && maxOutputHeight > 0 && height > maxOutputHeight;
