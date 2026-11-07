import type { MultipartDeps, MultipartTask } from '@/api/endpoints/voices';
import { createVoice, createVoiceParameters } from '@/api/endpoints/voices';
import { record } from '@/jobs/testFixtures';
import {
  makeVoiceConvertStarter,
  makeVoiceShiftStarter,
  makeVoiceSpeakStarter,
  voiceMultipart,
  type SpeakCall,
} from '@/jobs/starters/voices';
import { quotaMetricForJob } from '@/tools/metric';
import {
  buildChange,
  buildShift,
  changeBlockReason,
  applyShiftPreset,
  shiftDefaults,
} from '@/tools/options/voices';
import { VOICE_CONSENT_TEXT_VERSION } from '@/tools/voices/consent';
import { track } from '@/analytics/track';

jest.mock('@/analytics/track', () => ({ track: jest.fn() }));
beforeEach(() => (track as jest.Mock).mockClear());

const signal = () => new AbortController().signal;

function deps(status: number, body: unknown) {
  const calls: { uri: string; url: string; opts: Parameters<MultipartDeps['makeTask']>[2] }[] = [];
  const d: MultipartDeps = {
    baseUrl: 'https://api.test/api',
    buildHeaders: async () => ({ Authorization: 'Bearer t' }),
    makeTask: (uri, url, opts): MultipartTask => {
      calls.push({ uri, url, opts });
      return {
        uploadAsync: async () => ({ status, headers: {}, body: JSON.stringify(body) }),
        cancel: jest.fn(),
      };
    },
  };
  return { d, calls };
}

describe('voice job starters (MA34 decisions 7-8)', () => {
  it('speak with a saved voice sends the voice id, text, language and exaggeration to the speak route', async () => {
    const call: SpeakCall = jest.fn(async () => ({ ok: true as const, jobId: 'job-1' }));
    const s = makeVoiceSpeakStarter(call);
    const opts = {
      tool: 'voice_tts',
      voiceId: 'v1',
      text: 'Привет',
      language: 'ru',
      exaggeration: 0.5,
      source: 'tool_page',
    } as const;
    const r = await s.start(record({ options: opts, transport: 'starter' }), signal());
    expect(r).toEqual({ ok: true, jobId: 'job-1' });
    expect(call).toHaveBeenCalledWith(opts);
  });

  it('speak with a preset carries no exaggeration', async () => {
    const call: SpeakCall = jest.fn(async () => ({ ok: true as const, jobId: 'job-2' }));
    const s = makeVoiceSpeakStarter(call);
    await s.start(
      record({
        options: {
          tool: 'voice_tts',
          preset: 'Vivian',
          text: 'Hi',
          language: 'en',
          source: 'tool_page',
        },
        transport: 'starter',
      }),
      signal(),
    );
    const sent = (call as jest.Mock).mock.calls[0]![0];
    expect(sent.preset).toBe('Vivian');
    expect('exaggeration' in sent).toBe(false);
  });

  it('a 4xx from speak is rejected (terminal), a network error is failed (retryable), options of another tool fail the contract', async () => {
    const rejected = makeVoiceSpeakStarter(async () => ({
      ok: false,
      error: { status: 400, code: 'api:text_too_long', details: {} },
    }));
    const opts = {
      tool: 'voice_tts',
      voiceId: 'v',
      text: 'x',
      language: 'en',
      source: 'tool_page',
    } as const;
    expect(await rejected.start(record({ options: opts }), signal())).toMatchObject({
      ok: false,
      kind: 'rejected',
      status: 400,
    });
    const net = makeVoiceSpeakStarter(async () => ({
      ok: false,
      error: { status: 'FETCH_ERROR', code: 'network', details: {} },
    }));
    expect(await net.start(record({ options: opts }), signal())).toMatchObject({
      ok: false,
      kind: 'failed',
      reason: 'network',
    });
    expect(await net.start(record({ options: { format: 'png' } }), signal())).toMatchObject({
      ok: false,
    });
  });

  it('convert posts multipart input + voiceId (a saved voice) to /voices/convert', async () => {
    const { d, calls } = deps(202, { jobId: 'job-c', tool: 'voice_convert' });
    const s = makeVoiceConvertStarter(() => d);
    const options = buildChange({ voiceId: 'voice-9' });
    const r = await s.start(
      record({
        options,
        transport: 'starter',
        mediaKind: 'audio',
        fileUri: 'file:///c/in.m4a',
        mimeType: 'audio/mp4',
      }),
      signal(),
    );
    expect(r).toEqual({ ok: true, jobId: 'job-c' });
    expect(calls[0]!.url).toBe('https://api.test/api/voices/convert');
    expect(calls[0]!.opts.fieldName).toBe('input');
    expect(calls[0]!.opts.parameters).toEqual({ voiceId: 'voice-9' });
  });

  it('convert to a preset sends preset + language, never both voiceId and preset', async () => {
    expect(voiceMultipart(buildChange({ preset: 'Vivian', language: 'ru' })).parameters).toEqual({
      preset: 'Vivian',
      language: 'ru',
    });
    expect(voiceMultipart(buildChange({ voiceId: 'v', preset: 'Vivian' })).parameters).toEqual({
      voiceId: 'v',
    });
  });

  it('shift posts semitones, formant and the preset to /voices/shift and emits the upload events', async () => {
    const { d, calls } = deps(202, { jobId: 'job-s', tool: 'voice_shift' });
    const s = makeVoiceShiftStarter(() => d);
    const options = buildShift(applyShiftPreset(shiftDefaults, 'child'));
    const r = await s.start(
      record({ options, transport: 'starter', mediaKind: 'audio', fileUri: 'file:///c/in.m4a' }),
      signal(),
    );
    expect(r).toEqual({ ok: true, jobId: 'job-s' });
    expect(calls[0]!.url).toBe('https://api.test/api/voices/shift');
    expect(calls[0]!.opts.parameters).toEqual({
      semitones: '7',
      formant: 'shifted',
      preset: 'child',
    });
    const names = (track as jest.Mock).mock.calls.map((c) => c[0]);
    expect(names).toEqual(['upload_started', 'upload_completed']);
  });

  it('a shift refused by the API ends rejected and emits upload_failed', async () => {
    const { d } = deps(400, { error: 'shift_invalid', message: 'bad' });
    const s = makeVoiceShiftStarter(() => d);
    const r = await s.start(
      record({ options: buildShift(shiftDefaults), transport: 'starter', mediaKind: 'audio' }),
      signal(),
    );
    expect(r).toMatchObject({ ok: false, kind: 'rejected', reason: 'api:shift_invalid' });
    expect((track as jest.Mock).mock.calls.map((c) => c[0])).toEqual([
      'upload_started',
      'upload_failed',
    ]);
  });

  it('an already-aborted start is cancelled before any bytes move', async () => {
    const { d, calls } = deps(202, { jobId: 'x', tool: 'voice_shift' });
    const ac = new AbortController();
    ac.abort();
    const r = await makeVoiceShiftStarter(() => d).start(
      record({ options: buildShift(shiftDefaults), transport: 'starter' }),
      ac.signal,
    );
    expect(r).toMatchObject({ ok: false, kind: 'cancelled' });
    expect(calls).toHaveLength(0);
  });

  it('shift clamps to +-12 and the metric follows the API (ai_ops for convert / speak, ops for shift)', () => {
    expect(buildShift({ semitones: 40, formant: 'shifted' }).semitones).toBe(12);
    expect(buildShift({ semitones: -40, formant: 'shifted' }).semitones).toBe(-12);
    expect(quotaMetricForJob(buildShift(shiftDefaults))).toBe('ops');
    expect(quotaMetricForJob(buildChange({ preset: 'Vivian' }))).toBe('ai_ops');
    expect(quotaMetricForJob({ tool: 'voice_tts' })).toBe('ai_ops');
  });

  it('change is blocked without a target and over the plan cap', () => {
    expect(changeBlockReason({})).toBe('no_target');
    expect(
      changeBlockReason(
        { preset: 'x', convertMaxSeconds: 60 },
        {
          input: {
            name: 'a',
            extension: 'm4a',
            mime: 'audio/mp4',
            mediaKind: 'audio',
            durationSec: 61,
          },
        },
      ),
    ).toBe('too_long');
    expect(
      changeBlockReason(
        { preset: 'x', convertMaxSeconds: 60 },
        {
          input: {
            name: 'a',
            extension: 'm4a',
            mime: 'audio/mp4',
            mediaKind: 'audio',
            durationSec: 60,
          },
        },
      ),
    ).toBeNull();
  });
});

describe('clone multipart (MA34 decision 5)', () => {
  const input = {
    file: { uri: 'file:///c/voice-sample.m4a', mimeType: 'audio/mp4' },
    name: 'Mitch',
    languageHint: 'ru',
    consent: true as const,
    consentTextVersion: VOICE_CONSENT_TEXT_VERSION,
  };
  it('sends part `reference` (the file) plus name, languageHint, consent=true and consentTextVersion=2026-10-28', async () => {
    const { d, calls } = deps(201, {
      id: 'v1',
      name: 'Mitch',
      kind: 'cloned',
      languageHint: 'ru',
      engineVersion: '1',
      consentAt: '2026-11-07T00:00:00Z',
      createdAt: 'a',
      updatedAt: 'b',
    });
    const r = await createVoice(input, d);
    expect(r.ok).toBe(true);
    expect(calls[0]!.url).toBe('https://api.test/api/voices');
    expect(calls[0]!.opts.fieldName).toBe('reference');
    expect(calls[0]!.uri).toBe('file:///c/voice-sample.m4a');
    expect(calls[0]!.opts.parameters).toEqual({
      name: 'Mitch',
      languageHint: 'ru',
      consent: 'true',
      consentTextVersion: '2026-10-28',
    });
    // The part list: reference + these four text parts, nothing else.
    expect(Object.keys(createVoiceParameters(input)).sort()).toEqual([
      'consent',
      'consentTextVersion',
      'languageHint',
      'name',
    ]);
  });

  it('maps a refused clone (no speech, over the plan limit) to the server code and details', async () => {
    const a = await createVoice(input, deps(400, { error: 'no_speech_detected', message: 'x' }).d);
    expect(a).toMatchObject({ ok: false, error: { code: 'api:no_speech_detected' } });
    const b = await createVoice(input, deps(403, { error: 'voice_limit', limit: 1, used: 1 }).d);
    expect(b).toMatchObject({ ok: false, error: { status: 403, details: { limit: 1, used: 1 } } });
  });

  it('a malformed 201 is a contract mismatch, a thrown task is a network error', async () => {
    expect(await createVoice(input, deps(201, { nope: true }).d)).toMatchObject({
      ok: false,
      error: { code: 'contract_mismatch' },
    });
    const boom: MultipartDeps = {
      buildHeaders: async () => ({}),
      makeTask: () => ({
        uploadAsync: async () => {
          throw new Error('socket');
        },
        cancel: jest.fn(),
      }),
    };
    expect(await createVoice(input, boom)).toMatchObject({ ok: false, error: { code: 'network' } });
  });

  it('the consent version constant equals the web and server value', () => {
    expect(VOICE_CONSENT_TEXT_VERSION).toBe('2026-10-28');
  });
});
