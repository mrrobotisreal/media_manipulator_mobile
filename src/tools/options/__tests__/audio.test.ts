import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AUDIO_BASE,
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
  overHeightLimit,
  sameAsOriginalFormat,
  resolveWaveformSize,
} from '../audio';
import { audioConversionSchema } from '../audioSchema';

const DIR = join(__dirname, '__golden__');

function golden(name: string, actual: unknown): void {
  const file = join(DIR, `${name}.json`);
  const text = `${JSON.stringify(actual, null, 2)}\n`;
  if (process.env.UPDATE_GOLDEN === '1') {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(file, text);
  }
  expect(existsSync(file)).toBe(true);
  expect(text).toBe(readFileSync(file, 'utf8'));
}

const nonMode: Record<string, unknown> = {
  'audio-convert.mp3-192': buildAudioConvert(audioConvertDefaults),
  'audio-convert.flac-no-bitrate-ui': buildAudioConvert({
    ...audioConvertDefaults,
    format: 'flac',
  }),
  'audio-convert.mono-48k': buildAudioConvert({
    ...audioConvertDefaults,
    format: 'opus',
    bitrate: '128',
    sampleRate: '48000',
    channels: 'mono',
  }),
  'audio-trim.range': buildAudioTrim(
    { ...audioTrimDefaults, startTime: 12.345, endTime: 47.8 },
    'm4a',
  ),
  'audio-trim.fades': buildAudioTrim(
    { ...audioTrimDefaults, startTime: 5, endTime: 65, fadeIn: 2, fadeOut: 1.5 },
    'mp3',
  ),
  'audio-effects.speed': buildAudioEffects(audioEffectsDefaults, 'mp3'),
  'audio-effects.pitch-minus-3': buildAudioEffects(
    { ...audioEffectsDefaults, effects: ['pitch'], pitch: -3 },
    'wav',
  ),
  'audio-effects.normalize-eq-reverb': buildAudioEffects(
    {
      ...audioEffectsDefaults,
      effects: ['normalize', 'eq', 'reverb'],
      eq: 'vocal',
      reverb: 'plate',
    },
    'flac',
  ),
  'audio-effects.volume': buildAudioEffects(
    { ...audioEffectsDefaults, effects: ['volume'], volume: 0.5 },
    'xyz',
  ),
};

describe('audio option goldens', () => {
  for (const [name, built] of Object.entries(nonMode)) {
    it(`${name} matches its golden and the Zod port`, () => {
      golden(name, built);
      expect(audioConversionSchema.safeParse(built).success).toBe(true);
    });
  }

  it('every non-mode golden carries all five AUDIO_BASE keys with the API types', () => {
    for (const built of Object.values(nonMode) as Record<string, unknown>[]) {
      for (const k of ['bitrate', 'sampleRate', 'channels'] as const)
        expect(typeof built[k]).toBe('string');
      for (const k of ['speed', 'volume'] as const) expect(typeof built[k]).toBe('number');
    }
    expect(Object.keys(AUDIO_BASE).sort()).toEqual(
      ['bitrate', 'channels', 'sampleRate', 'speed', 'volume'].sort(),
    );
  });

  it('never sends the out-of-scope keys', () => {
    for (const built of Object.values(nonMode) as Record<string, any>[]) {
      expect(built.metadataMode).toBeUndefined();
      expect(built.ai).toBeUndefined();
      expect(built.restoration).toBeUndefined();
      expect(built.advanced?.timeStretch).toBeUndefined();
      expect(built.timeBasedEffects?.delay).toBeUndefined();
      expect(built.basicProcessing?.amplify).toBeUndefined();
    }
  });

  it('audio-effects.speed keeps unchosen volume at 1 and omits other blocks', () => {
    const o = nonMode['audio-effects.speed'] as Record<string, unknown>;
    expect(o).toMatchObject({ speed: 1.5, volume: 1 });
    expect(o.basicProcessing).toBeUndefined();
    expect(o.advanced).toBeUndefined();
  });

  it('audio-waveform.default is byte-equal to the web panel default payload', () => {
    // Literal copy of what audio-waveform-panel.tsx buildAndSubmit sends with untouched defaults.
    const web = {
      mode: 'audio_waveform',
      waveform: {
        outputSelection: 'video',
        videoFormat: 'mp4',
        imageFormat: 'png',
        width: 1600,
        height: 160,
        mode: 'point',
        splitChannels: false,
        colorPrimary: '#22D3EE',
        colorSecondary: '#A855F7',
        scale: 'lin',
        draw: 'scale',
        includeAudio: true,
        rate: 25,
      },
    };
    const built = buildAudioWaveform(audioWaveformDefaults);
    expect(JSON.stringify(built)).toBe(JSON.stringify(web));
    golden('audio-waveform.default', built);
  });

  it('audio-waveform.both-1x1', () => {
    const built = buildAudioWaveform({
      ...audioWaveformDefaults,
      output: 'both',
      sizeId: 'xl-1x1',
      mode: 'cline',
      splitChannels: true,
      videoFormat: 'webm',
      rate: 30,
    });
    golden('audio-waveform.both-1x1', built);
    expect((built.waveform as any).height).toBe(2160);
  });

  it('image output drops includeAudio; custom sizes are even and clamped', () => {
    const o = buildAudioWaveform({ ...audioWaveformDefaults, output: 'image' }).waveform as any;
    expect(o.includeAudio).toBe(false);
    expect(
      resolveWaveformSize({
        ...audioWaveformDefaults,
        sizeId: 'custom',
        customWidth: '1001',
        customHeight: '10',
      }),
    ).toEqual({ width: 1002, height: 64 });
  });
});

describe('helpers', () => {
  it('same-as-original mapping', () => {
    expect(
      ['mp3', 'wav', 'flac', 'ogg', 'opus', 'm4a', 'aac', 'aiff', 'caf', undefined].map((e) =>
        sameAsOriginalFormat(e),
      ),
    ).toEqual(['mp3', 'wav', 'flac', 'ogg', 'opus', 'aac', 'aac', 'mp3', 'mp3', 'mp3']);
  });
  it('trim keeps the 0.1 s gap and omits zero fades', () => {
    const o = buildAudioTrim({ ...audioTrimDefaults, startTime: 5, endTime: 5 }) as any;
    expect(o.trim.endTime).toBe(5.1);
    expect(o.basicProcessing).toBeUndefined();
  });
  it('analytics slugs', () => {
    const c = (format: any) => audioConvertSlug({ ...audioConvertDefaults, format });
    expect(c('wav')).toBe('convert-audio-to-wav');
    expect(c('flac')).toBe('convert-audio-to-flac');
    expect(c('ogg')).toBe('convert-audio-to-ogg');
    expect(c('aac')).toBe('convert-audio-to-m4a');
    expect(c('opus')).toBe('convert-audio-to-opus');
    expect(c('alac')).toBe('audio-converter');
    expect(c('mp3')).toBe('audio-converter');
    expect(audioConvertSlug(audioConvertDefaults, 'wav')).toBe('convert-wav-to-mp3');
    const e = (effects: any) => audioEffectsSlug({ ...audioEffectsDefaults, effects });
    expect(e(['reverb', 'eq'])).toBe('audio-equalizer');
    expect(e(['volume', 'pitch'])).toBe('change-audio-pitch');
    expect(e(['normalize'])).toBe('normalize-audio');
    expect(e(['volume'])).toBe('adjust-audio-volume');
    expect(e(['reverb'])).toBe('add-reverb-to-audio');
    expect(e(['speed', 'pitch'])).toBe('change-audio-speed');
  });
  it('height gate', () => {
    expect(overHeightLimit(2160, 1440)).toBe(true);
    expect(overHeightLimit(1080, 1440)).toBe(false);
    expect(overHeightLimit(2160, -1)).toBe(false);
    expect(overHeightLimit(2160, undefined)).toBe(false);
  });
});
