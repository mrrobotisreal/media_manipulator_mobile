import {
  designPreviewSchema,
  savedVoiceSchema,
  voiceDeletedSchema,
  voiceJobStartSchema,
  voicesCapabilitiesSchema,
  voicesListSchema,
} from '@/api/schemas/voices';

/** Fixtures shaped like the Go handlers' answers (voices.go Capabilities / List / Create / DesignPreview / run / Delete). */
const capabilities = {
  enabled: true,
  warm: false,
  engines: { chatterbox: { loaded: false, version: '0.1.7' } },
  languages: ['ar', 'en', 'ru'],
  designLanguages: ['en', 'ru'],
  presets: [
    {
      id: 'Vivian',
      name: 'Vivian',
      description: '',
      language: '',
      engine: 'qwen_tts',
      kind: 'custom_voice',
      languages: ['en', 'ru'],
    },
    {
      id: 'Plain',
      name: 'Plain',
      description: '',
      language: 'en',
      engine: 'x',
      kind: 'k',
      languages: null,
    },
  ],
  shiftPresets: [
    { id: 'deeper', semitones: -4, formant: 'shifted' },
    {
      id: 'telephone',
      semitones: 0,
      formant: 'preserved',
      filter: 'highpass=f=300,lowpass=f=3400',
    },
  ],
  signedIn: true,
  limits: {
    voicesSaved: 1,
    voicesMaxSeconds: 60,
    voicesConvert: true,
    voicesConvertMaxSeconds: 60,
    textMaxChars: 1080,
  },
  tier: 'free',
};
const voice = {
  id: '0b1d2c3e-0000-4000-8000-000000000001',
  name: 'Mitch',
  kind: 'cloned',
  languageHint: 'ru',
  engineVersion: '0.1.7',
  consentAt: '2026-11-07T10:00:00Z',
  consentTextVersion: '2026-10-28',
  previewUrl: 'https://s3.example/voices/u/v/preview.mp3?sig=1',
  createdAt: '2026-11-07T10:00:00Z',
  updatedAt: '2026-11-07T10:00:00Z',
};

describe('voices schemas', () => {
  it('parses the capabilities answer (enabled, presets with and without languages, shift presets)', () => {
    const c = voicesCapabilitiesSchema.parse(capabilities);
    expect(c.enabled).toBe(true);
    expect(c.limits.textMaxChars).toBe(1080);
    expect(c.presets[0]!.languages).toEqual(['en', 'ru']);
    expect(c.presets[1]!.languages).toBeNull();
    expect(c.shiftPresets[1]!.filter).toContain('lowpass');
  });

  it('parses the disabled and anonymous capabilities (the production answer of 2026-11-07)', () => {
    const c = voicesCapabilitiesSchema.parse({
      enabled: false,
      warm: false,
      engines: {},
      languages: ['en'],
      designLanguages: ['en'],
      presets: [],
      shiftPresets: [],
      signedIn: false,
      limits: {
        voicesSaved: 0,
        voicesMaxSeconds: 30,
        voicesConvert: false,
        voicesConvertMaxSeconds: 0,
        textMaxChars: 540,
      },
      tier: 'anonymous',
    });
    expect(c.enabled).toBe(false);
    expect(c.limits.voicesSaved).toBe(0);
  });

  it('parses a saved voice, a designed voice with a seed, and a voice without a preview URL', () => {
    expect(savedVoiceSchema.parse(voice).consentAt).toBe('2026-11-07T10:00:00Z');
    const d = savedVoiceSchema.parse({
      ...voice,
      kind: 'designed',
      consentAt: null,
      description: 'warm',
      seed: 123456789012,
      previewUrl: undefined,
    });
    expect(d.seed).toBe(123456789012);
    expect(d.consentAt).toBeNull();
    expect(d.previewUrl).toBeUndefined();
  });

  it('parses the list with -1 meaning unlimited', () => {
    const l = voicesListSchema.parse({ voices: [voice], limit: -1, used: 1 });
    expect(l.limit).toBe(-1);
    expect(l.voices).toHaveLength(1);
  });

  it('parses the design preview, the job start and the delete answer', () => {
    expect(
      designPreviewSchema.parse({ seed: 7, mime: 'audio/mpeg', seconds: 4.2, audioBase64: 'AAAA' })
        .seed,
    ).toBe(7);
    expect(voiceJobStartSchema.parse({ jobId: 'j1', tool: 'voice_tts' }).tool).toBe('voice_tts');
    expect(() => voiceJobStartSchema.parse({ jobId: 'j1', tool: 'voice_other' })).toThrow();
    expect(
      voiceDeletedSchema.parse({ deleted: { objects: 2, bytes: 100 }, pending: 0 }).pending,
    ).toBe(0);
  });

  it('rejects an empty design preview and a voice with no id', () => {
    expect(() => designPreviewSchema.parse({ seed: 1, audioBase64: '' })).toThrow();
    expect(() => savedVoiceSchema.parse({ ...voice, id: '' })).toThrow();
  });
});
