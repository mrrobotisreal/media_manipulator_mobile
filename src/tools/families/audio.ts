import { AUDIO_ACCEPTS, audioBase, row } from './shared';

const a = (r: Omit<Parameters<typeof row>[0], 'family' | 'accepts' | 'endpoint' | 'metric'>) =>
  row({ ...r, family: 'audio', accepts: AUDIO_ACCEPTS, endpoint: 'upload', metric: 'ops' });

export const audioTools = [
  a({
    id: 'audio-convert',
    icon: 'Music',
    defaults: audioBase(),
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
  a({
    id: 'audio-trim',
    icon: 'Scissors',
    defaults: audioBase({ trim: { startTime: 0, endTime: 30 } }),
    analyticsSlug: 'trim-audio',
    webTask: 'trim_audio',
    resultHint: 'audio',
    keywords: ['trim-audio', 'cut', 'clip'],
  }),
  a({
    id: 'audio-effects',
    icon: 'Sliders',
    defaults: audioBase({ basicProcessing: { normalize: true } }),
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
  a({
    id: 'audio-waveform',
    icon: 'AudioWaveform',
    defaults: {
      mode: 'audio_waveform',
      waveform: {
        outputSelection: 'video',
        videoFormat: 'mp4',
        imageFormat: 'png',
        width: 1600,
        height: 160,
        mode: 'point',
        splitChannels: false,
      },
    },
    analyticsSlug: 'audio-waveform-generator',
    webTask: 'audio_waveform',
    resultHint: 'video',
    keywords: ['audio-waveform-generator', 'visualizer', 'sound-wave'],
  }),
];
