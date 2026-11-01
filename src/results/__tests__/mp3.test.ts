import { track } from '@/analytics/track';
import {
  canOfferMp3,
  convertToMp3,
  mp3NameFor,
  MP3_POLL_MS,
  MP3_POLL_TIMEOUT_MS,
  type Mp3Deps,
} from '../mp3';

jest.mock('@/analytics/track', () => ({ track: jest.fn() }));

const ctx = { jobId: 'job-1', toolSlug: 'isolate-vocals-from-song', mediaKind: 'audio' as const };
const ready = {
  status: 'ready' as const,
  url: '/api/download/job-1?token=m',
  absoluteUrl: 'https://api.test/api/download/job-1?token=m',
  sizeBytes: 5,
  fileName: 'Song.mp3',
};

function deps(responses: unknown[], over: Partial<Mp3Deps> = {}) {
  let t = 0;
  const queue = [...responses];
  const next = async () => {
    const r = queue.shift();
    if (r instanceof Error || (r && typeof r === 'object' && 'httpStatus' in (r as object)))
      throw r;
    return r;
  };
  return {
    start: jest.fn(next),
    poll: jest.fn(next),
    sleep: jest.fn(async (ms: number) => void (t += ms)),
    now: () => t,
    ...over,
  } as unknown as Mp3Deps & { start: jest.Mock; poll: jest.Mock; sleep: jest.Mock };
}
const names = () => (track as jest.Mock).mock.calls.map((c) => c[0]);

beforeEach(() => (track as jest.Mock).mockClear());

describe('canOfferMp3', () => {
  it('needs a .wav result AND a vocal-stem tool', () => {
    expect(canOfferMp3('stem.wav', 'isolate-vocals')).toBe(true);
    expect(canOfferMp3('STEM.WAV', 'x', 'remove_vocals')).toBe(true);
    expect(canOfferMp3('stem.wav', 'isolate-vocals-from-song')).toBe(true);
    expect(canOfferMp3('stem.mp3', 'isolate-vocals')).toBe(false);
    expect(canOfferMp3('clip.wav', 'audio-convert', 'audio_converter')).toBe(false);
    expect(canOfferMp3(undefined, 'isolate-vocals')).toBe(false);
  });
  it('names the MP3 after the WAV', () => {
    expect(mp3NameFor('My Song_converted.wav')).toBe('My Song_converted.mp3');
    expect(mp3NameFor('.wav')).toBe('converted.mp3');
  });
});

describe('convertToMp3', () => {
  it('202 -> poll -> ready: returns the link and emits download_started mp3 once', async () => {
    const d = deps([{ status: 'processing' }, { status: 'processing' }, ready]);
    const r = await convertToMp3('job-1', 'Song.wav', ctx, d);
    expect(r).toMatchObject({
      status: 'ready',
      fileName: 'Song.mp3',
      link: { absoluteUrl: ready.absoluteUrl },
    });
    expect(d.start).toHaveBeenCalledTimes(1);
    expect(d.poll).toHaveBeenCalledTimes(2);
    expect(d.sleep).toHaveBeenCalledWith(MP3_POLL_MS);
    expect(names()).toEqual(['download_started']);
    expect((track as jest.Mock).mock.calls[0]![1]).toEqual({
      job_id: 'job-1',
      output_format: 'mp3',
      size_bytes: undefined,
    });
  });

  it('already cached: ready on the first POST, no polling', async () => {
    const d = deps([ready]);
    await convertToMp3('job-1', 'Song.wav', ctx, d);
    expect(d.poll).not.toHaveBeenCalled();
  });

  it('gives up after 20 minutes with download_failed timeout', async () => {
    const d = deps([{ status: 'processing' }], {
      poll: jest.fn(async () => ({ status: 'processing' })),
    } as never);
    const r = await convertToMp3('job-1', 'Song.wav', ctx, d);
    expect(r).toEqual({ status: 'timeout' });
    const slept = d.sleep.mock.calls.reduce((n, c) => n + (c[0] as number), 0);
    expect(slept).toBeGreaterThanOrEqual(MP3_POLL_TIMEOUT_MS);
    expect((track as jest.Mock).mock.calls.at(-1)![0]).toBe('download_failed');
    expect((track as jest.Mock).mock.calls.at(-1)![1]).toMatchObject({ reason: 'timeout' });
  });

  it('a failed conversion emits download_failed mp3_failed', async () => {
    const d = deps([{ status: 'processing' }, { status: 'failed', error: 'ffmpeg' }]);
    expect(await convertToMp3('job-1', 'Song.wav', ctx, d)).toEqual({
      status: 'failed',
      httpStatus: undefined,
    });
    expect((track as jest.Mock).mock.calls.at(-1)![1]).toEqual({
      job_id: 'job-1',
      reason: 'mp3_failed',
      status: undefined,
    });
  });

  it('a 400 (not a WAV) is a failure carrying the status', async () => {
    const d = deps([Object.assign(new Error('x'), { status: 400 })]);
    expect(await convertToMp3('job-1', 'Song.wav', ctx, d)).toEqual({
      status: 'failed',
      httpStatus: 400,
    });
  });

  it('ignores a second tap while converting', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const d = deps([], { start: jest.fn(async () => (await gate, ready)) } as never);
    const first = convertToMp3('job-1', 'Song.wav', ctx, d);
    expect(await convertToMp3('job-1', 'Song.wav', ctx, d)).toEqual({ status: 'skipped' });
    release();
    await first;
    expect(d.start).toHaveBeenCalledTimes(1);
  });
});
