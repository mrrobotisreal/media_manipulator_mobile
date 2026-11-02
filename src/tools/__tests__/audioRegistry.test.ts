import { TOOL_BY_ID } from '../registry';
import { WEB_TOOL_SLUGS } from '../__fixtures__/webTools';
import type { ToolContext } from '../types';

const file = (extension: string): ToolContext => ({
  input: {
    name: `x.${extension}`,
    uri: 'file:///x',
    extension,
    mime: 'audio/x',
    mediaKind: 'audio',
  },
});

describe('audio registry rows', () => {
  it('are multipart upload, ops, audio-only, non-gpu', () => {
    for (const id of ['audio-convert', 'audio-trim', 'audio-effects', 'audio-waveform']) {
      const t = TOOL_BY_ID.get(id)!;
      expect(t.endpoint).toBe('upload');
      expect(t.metric).toBe('ops');
      expect(t.gpu).toBe(false);
      expect(t.accepts.kinds).toEqual(['audio']);
    }
    expect(TOOL_BY_ID.get('audio-convert')!.accepts.extensions).toEqual(
      expect.arrayContaining([
        'mp3',
        'wav',
        'm4a',
        'aac',
        'flac',
        'ogg',
        'opus',
        'ac3',
        'dts',
        'aiff',
        'caf',
      ]),
    );
  });

  it('default options always carry the five API-required fields', () => {
    for (const id of ['audio-convert', 'audio-trim', 'audio-effects']) {
      const t = TOOL_BY_ID.get(id)!;
      expect(t.optionsBuilder(t.defaults, file('mp3'))).toMatchObject({
        bitrate: '192',
        sampleRate: '44100',
        channels: 'stereo',
        speed: expect.any(Number),
        volume: expect.any(Number),
      });
    }
  });

  it('analyticsSlugFor table', () => {
    const convert = TOOL_BY_ID.get('audio-convert')!;
    const slug = (format: string, ext = 'm4a') =>
      convert.analyticsSlugFor!({ ...convert.defaults, format }, file(ext));
    expect(slug('mp3')).toBe('audio-converter');
    expect(slug('mp3', 'wav')).toBe('convert-wav-to-mp3');
    expect(slug('wav')).toBe('convert-audio-to-wav');
    expect(slug('flac')).toBe('convert-audio-to-flac');
    expect(slug('ogg')).toBe('convert-audio-to-ogg');
    expect(slug('aac')).toBe('convert-audio-to-m4a');
    expect(slug('opus')).toBe('convert-audio-to-opus');
    const fx = TOOL_BY_ID.get('audio-effects')!;
    const f = (effects: string[]) => fx.analyticsSlugFor!({ ...fx.defaults, effects }, file('mp3'));
    expect(f(['speed'])).toBe('change-audio-speed');
    expect(f(['pitch'])).toBe('change-audio-pitch');
    expect(f(['normalize'])).toBe('normalize-audio');
    expect(f(['volume'])).toBe('adjust-audio-volume');
    expect(f(['eq'])).toBe('audio-equalizer');
    expect(f(['reverb'])).toBe('add-reverb-to-audio');
  });

  it('every produced slug and preset slug is a real web slug', () => {
    for (const id of ['audio-convert', 'audio-effects']) {
      for (const p of TOOL_BY_ID.get(id)!.presets ?? [])
        expect(WEB_TOOL_SLUGS).toContain(p.analyticsSlug);
    }
  });

  it('audio-effects cannot run with no chip', () => {
    const fx = TOOL_BY_ID.get('audio-effects')!;
    expect(fx.blockReason!({ ...fx.defaults, effects: [] })).not.toBeNull();
    expect(fx.blockReason!(fx.defaults)).toBeNull();
  });

  it('presets land on the web catalog defaults', () => {
    const fx = TOOL_BY_ID.get('audio-effects')!;
    const p = (id: string) => fx.presets!.find((x) => x.id === id)!.defaults;
    expect(p('speed')).toMatchObject({ speed: 1.5 });
    expect(p('pitch')).toMatchObject({ pitch: 2 });
    expect(p('volume')).toMatchObject({ volume: 1.5 });
    expect(p('eq')).toMatchObject({ eq: 'bass-boost' });
    expect(p('reverb')).toMatchObject({ reverb: 'hall' });
  });
});
