import { track } from '@/analytics/track';
import { record, snapshot } from '@/jobs/testFixtures';
import { buildChange, buildShift, shiftDefaults } from '@/tools/options/voices';
import {
  resetVoiceAnalyticsForTests,
  trackVoiceCreated,
  trackVoiceGenerated,
  voiceCreatedProps,
  voiceGeneratedProps,
  voiceSecondsBucket,
} from '../analytics';
import { trackVoiceGeneratedFor } from '../jobAnalytics';
import catalog from '../../../__fixtures__/analytics-catalog.fixture.json';

jest.mock('@/analytics/track', () => ({ track: jest.fn() }));
const calls = () =>
  (track as jest.Mock).mock.calls as [string, Record<string, unknown>, Record<string, unknown>][];
beforeEach(() => {
  (track as jest.Mock).mockClear();
  resetVoiceAnalyticsForTests();
});
const cat = catalog as unknown as Record<string, { priority: number; props: string[] }>;

describe('voice analytics (MA34 decision 11)', () => {
  it('voiceSecondsBucket equals the web buckets (lower bound inclusive)', () => {
    expect([0, 9.99, 10, 29.9, 30, 59.9, 60, 299, 300, 900].map(voiceSecondsBucket)).toEqual([
      '0-10',
      '0-10',
      '10-30',
      '10-30',
      '30-60',
      '30-60',
      '60-300',
      '60-300',
      '300+',
      '300+',
    ]);
    expect(voiceSecondsBucket(NaN)).toBe('0-10');
  });

  it('voice_created props equal the web helper for fixtures', () => {
    expect(voiceCreatedProps('cloned', 'ru')).toEqual({ kind: 'cloned', languageHint: 'ru' });
    expect(voiceCreatedProps('designed', undefined)).toEqual({
      kind: 'designed',
      languageHint: 'en',
    });
    expect(voiceCreatedProps('cloned', 'pt-BR')).toEqual({ kind: 'cloned', languageHint: 'en' });
  });

  it('voice_generated props equal the web helper for fixtures', () => {
    expect(
      voiceGeneratedProps({
        tool: 'voice_tts',
        resultSeconds: 12.5,
        language: 'ru',
        source: 'tool_page',
      }),
    ).toEqual({
      kind: 'tts',
      secondsBucket: '10-30',
      language: 'ru',
      source: 'tool_page',
    });
    expect(
      voiceGeneratedProps({
        tool: 'voice_shift',
        resultSeconds: 70,
        language: 'ru',
        source: 'tool_page',
      }),
    ).toEqual({
      kind: 'shift',
      secondsBucket: '60-300',
      language: 'none',
      source: 'tool_page',
    });
    expect(
      voiceGeneratedProps({
        tool: 'voice_convert',
        resultSeconds: undefined,
        language: undefined,
        source: 'account',
      }),
    ).toEqual({
      kind: 'convert',
      secondsBucket: '0-10',
      language: 'none',
      source: 'account',
    });
  });

  it('one voice_generated payload: the speak job completed from My voices (source account)', () => {
    const r = record({
      state: 'completed',
      jobId: 'job-77',
      transport: 'starter',
      mediaKind: 'audio',
      options: {
        tool: 'voice_tts',
        voiceId: 'secret-voice-id',
        text: 'SECRET SPOKEN TEXT',
        language: 'ru',
        exaggeration: 0.5,
        source: 'account',
      },
      job: snapshot({ id: 'job-77', status: 'completed', resultSeconds: 14.2 }),
    });
    trackVoiceGeneratedFor(r);
    expect(calls()).toEqual([
      [
        'voice_generated',
        { kind: 'tts', secondsBucket: '10-30', language: 'ru', source: 'account' },
        { job_id: 'job-77', feature: 'voices', tool_slug: 'voice-cloning' },
      ],
    ]);
  });

  it('fires once per completed job id (a re-poll or a restore never counts twice)', () => {
    const r = record({
      state: 'completed',
      jobId: 'job-1',
      transport: 'starter',
      mediaKind: 'audio',
      options: buildShift(shiftDefaults),
      job: snapshot({ resultSeconds: 5 }),
    });
    trackVoiceGeneratedFor(r);
    trackVoiceGeneratedFor(r);
    expect(
      trackVoiceGenerated('job-1', {
        tool: 'voice_shift',
        resultSeconds: 5,
        language: undefined,
        source: 'tool_page',
      }),
    ).toBe(false);
    expect(calls()).toHaveLength(1);
  });

  it('failed, rejected and non-voice jobs emit nothing', () => {
    trackVoiceGeneratedFor(
      record({ state: 'failed', jobId: 'j', options: buildShift(shiftDefaults) }),
    );
    trackVoiceGeneratedFor(record({ state: 'completed', jobId: 'k', options: { format: 'png' } }));
    trackVoiceGeneratedFor(record({ state: 'completed', options: buildChange({ preset: 'x' }) }));
    expect(calls()).toHaveLength(0);
  });

  it('convert to a preset reports the language, to a saved voice reports none', () => {
    const base = {
      state: 'completed' as const,
      transport: 'starter' as const,
      mediaKind: 'audio' as const,
      job: snapshot({ resultSeconds: 3 }),
    };
    trackVoiceGeneratedFor(
      record({ ...base, jobId: 'a', options: buildChange({ preset: 'Vivian', language: 'ru' }) }),
    );
    trackVoiceGeneratedFor(record({ ...base, jobId: 'b', options: buildChange({ voiceId: 'v' }) }));
    expect(calls().map((c) => c[1].language)).toEqual(['ru', 'none']);
  });

  it('voice_created carries the feature context and the web tool slug', () => {
    trackVoiceCreated('designed', 'en', 'voice-designer');
    expect(calls()).toEqual([
      [
        'voice_created',
        { kind: 'designed', languageHint: 'en' },
        { tool_slug: 'voice-designer', feature: 'voices' },
      ],
    ]);
  });

  it('props are exactly the catalog KnownProps, and never a name, description, text or audio', () => {
    expect(Object.keys(voiceCreatedProps('cloned', 'en')).sort()).toEqual(
      [...cat.voice_created!.props].sort(),
    );
    expect(
      Object.keys(
        voiceGeneratedProps({
          tool: 'voice_tts',
          resultSeconds: 1,
          language: 'en',
          source: 'tool_page',
        }),
      ).sort(),
    ).toEqual([...cat.voice_generated!.props].sort());
    trackVoiceCreated('cloned', 'en', 'voice-cloning');
    trackVoiceGeneratedFor(
      record({
        state: 'completed',
        jobId: 'z',
        transport: 'starter',
        mediaKind: 'audio',
        fileName: 'private-name.m4a',
        options: {
          tool: 'voice_tts',
          voiceId: 'vid-1',
          text: 'hello secret',
          language: 'en',
          source: 'tool_page',
        },
      }),
    );
    const dump = JSON.stringify(calls());
    for (const secret of ['hello secret', 'vid-1', 'private-name', 'Mitch'])
      expect(dump).not.toContain(secret);
  });
});
