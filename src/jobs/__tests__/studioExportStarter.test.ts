/**
 * MA58: a Darkroom render is created by the `studioExport` starter's JSON request (no upload) and
 * tracked like any job; refusals end `rejected` with the API's error (MA16's sheets read it); the
 * request body and the analytics order are pinned here against a fake fetch.
 */
import type { ConversionJob } from '@/api/schemas/job';
import type { MmError } from '@/api/errors';
import { normaliseError } from '@/api/errors';
import { describe as describeResult, jobFallbackFileName, jobTaskHint } from '@/results/describe';
import { limitVariantFor } from '@/quota/limitVariant';
import { createJobEngine, type JobEngineDeps, type JobStore } from '../jobEngine';
import {
  DARKROOM_EXPORT_TOOL,
  makeStudioExportStarter,
  rtkStudioExportCall,
  STUDIO_EXPORT_STARTER,
  studioExportSource,
  type StudioExportCall,
  type StudioExportJobOptions,
} from '../starters/studioExport';
import type { EventHandlers, JobTransport } from '../transport';
import type { JobRecord } from '../types';
import { snapshot } from '../testFixtures';

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const props = {
  preset: 'high',
  format: 'h264',
  container: 'mp4',
  videoCodec: 'h264',
  audioCodec: 'aac',
  audioBitrate: 192,
  audioChannels: 2,
  mode: 'preset' as const,
  resolution: '1080p',
  captionsMode: 'burn_in',
  captionAnimation: 'none',
  host: 'mm' as const,
};
const options = (over: Partial<StudioExportJobOptions> = {}): StudioExportJobOptions => ({
  tool: 'studio_export',
  projectId: 'proj-1',
  body: {
    fileName: 'Trip cut',
    preset: 'high',
    loudness: '',
    resolution: 1080,
    captionsMode: 'burn_in',
    outputPreset: 'mp4_h264',
  },
  timelineSeconds: 60,
  props,
  ...over,
});

function setup(call: StudioExportCall) {
  const track = jest.fn();
  const records = new Map<string, JobRecord>();
  const store: JobStore = {
    get: (id) => records.get(id),
    all: () => [...records.values()],
    put: (r) => void records.set(r.localId, r),
  };
  const streams: { jobId: string; h: EventHandlers }[] = [];
  let now = 1_000;
  const transport: JobTransport = {
    uploadMultipart: () => Promise.reject(new Error('a starter job must not upload')),
    presign: () => Promise.reject(new Error('no presign')),
    putBinary: () => Promise.reject(new Error('no put')),
    completePresign: () => Promise.reject(new Error('no complete')),
    fetchJob: () =>
      Promise.resolve({ ok: true, job: snapshot({ id: 'srv-1', status: 'pending' }) }),
    openJobEvents: (jobId, h) => {
      streams.push({ jobId, h });
      return { close: () => undefined };
    },
  };
  const deps: JobEngineDeps = {
    transport,
    store,
    now: () => now,
    appState: { current: () => 'active', subscribe: () => () => undefined },
    network: { subscribe: () => () => undefined },
    files: { exists: jest.fn(() => false), release: jest.fn(), keepOriginal: jest.fn() },
    onSettled: () => undefined,
    activation: { uid: () => null, signupAt: () => null, claim: async () => false },
    newId: () => 'n1',
    starters: { [STUDIO_EXPORT_STARTER]: makeStudioExportStarter(call, { track }) },
  };
  const engine = createJobEngine(deps);
  const start = (o: StudioExportJobOptions = options()) =>
    engine.startJobs([
      {
        tool: DARKROOM_EXPORT_TOOL,
        file: studioExportSource({
          projectId: 'proj-1',
          fileName: 'Trip cut',
          ext: 'mp4',
          mime: 'video/mp4',
          audioOnly: false,
          now: 0,
        }),
        starter: STUDIO_EXPORT_STARTER,
        options: o,
      },
    ])[0]!;
  return { engine, records, streams, track, start, tick: (ms: number) => (now += ms) };
}

describe('studioExport starter on the job engine', () => {
  it('posts the export (no upload), tracks the job and emits started -> completed with a ratio bucket', async () => {
    const calls: StudioExportJobOptions[] = [];
    const { engine, records, streams, track, start, tick } = setup(async (o) => {
      calls.push(o);
      return { ok: true, jobId: 'srv-1' };
    });
    await engine.start();
    const id = start();
    await flush();
    expect(calls[0]!.body).toEqual(options().body);
    expect(records.get(id)).toMatchObject({
      state: 'pending',
      jobId: 'srv-1',
      transport: 'starter',
      toolId: 'darkroom',
      analyticsSlug: 'darkroom',
      mediaKind: 'video',
    });
    engine.watch(id);
    tick(45_000);
    streams[0]!.h.onSnapshot(
      snapshot({
        id: 'srv-1',
        status: 'completed',
        options: { mode: 'studio_export', format: 'mp4' },
        originalFile: { name: 'Trip cut.mp4', size: 0, type: 'video/mp4' },
      }),
    );
    await flush();
    expect(records.get(id)!.state).toBe('completed');
    const names = track.mock.calls.map((c) => c[0]);
    expect(names).toEqual(['studio_export_started', 'studio_export_completed']);
    expect(track.mock.calls[0]![1]).toEqual(props);
    expect(track.mock.calls[0]![2]).toEqual({
      tool_slug: 'darkroom',
      feature: 'studio',
      job_id: 'srv-1',
    });
    expect(track.mock.calls[1]![1]).toEqual({ ...props, durationRatioBucket: '0.5-1x' });
    for (const [, p] of track.mock.calls) expect(JSON.stringify(p)).not.toContain('Trip cut');
  });

  it('Export again posts to the stored export, no body', async () => {
    const fetchMock = jest.fn(async (_url: string, init?: { method?: string; body?: unknown }) => ({
      status: 200,
      headers: new Headers(),
      text: () => Promise.resolve(JSON.stringify({ jobId: 'srv-2' })),
      init,
    }));
    const real = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { makeStore } = require('@/state/store') as typeof import('@/state/store');
      const { store } = makeStore();
      const call = rtkStudioExportCall(store.dispatch);
      const r = await call(options({ body: undefined, againExportId: 'exp-9' }));
      expect(r).toEqual({ ok: true, jobId: 'srv-2' });
      const url = fetchMock.mock.calls[0]![0];
      expect(url).toMatch(/\/studio\/projects\/proj-1\/exports\/exp-9\/again$/);
      expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'POST' });
      const r2 = await call(options());
      expect(r2).toEqual({ ok: true, jobId: 'srv-2' });
      expect(fetchMock.mock.calls[1]![0]).toMatch(/\/studio\/projects\/proj-1\/export$/);
      expect(JSON.parse(String(fetchMock.mock.calls[1]![1]!.body))).toEqual(options().body);
    } finally {
      global.fetch = real;
    }
  });

  it('403 format_not_in_plan and 429 export quota end rejected and map to MA16 sheets; no export events', async () => {
    for (const [status, body, kind] of [
      [
        403,
        {
          error: 'format_not_in_plan',
          message: 'x',
          limitKey: 'studio_format',
          required: 'premium',
          option: 'mov',
          upgradePath: '/pricing',
        },
        'format',
      ],
      [
        429,
        {
          error: 'quota_exceeded',
          tier: 'free',
          metric: 'export',
          limit: 30,
          used: 31,
          resetsAt: '2099-01-01T00:00:00Z',
        },
        'quota',
      ],
      [403, { error: 'output_height_limited', requested: 2160, limit: 1440 }, 'height'],
    ] as const) {
      const err: MmError = normaliseError(status, body);
      const { engine, records, track, start } = setup(async () => ({ ok: false, error: err }));
      await engine.start();
      const id = start();
      await flush();
      expect(records.get(id)).toMatchObject({ state: 'rejected', error: err });
      expect(track).not.toHaveBeenCalled();
      expect(limitVariantFor(records.get(id)!.error)).toMatchObject({ kind });
    }
    expect(
      limitVariantFor(
        normaliseError(429, { error: 'quota_exceeded', metric: 'export', limit: 30 }),
      ),
    ).toEqual({
      kind: 'quota',
      metric: 'export',
      limit: 30,
      resetsAt: undefined,
    });
    expect(
      limitVariantFor(
        normaliseError(403, {
          error: 'format_not_in_plan',
          option: 'advanced',
          required: 'premium',
        }),
      ),
    ).toEqual({
      kind: 'format',
      option: 'advanced',
      required: 'premium',
    });
  });

  it('a failed render emits studio_export_failed', async () => {
    const { engine, streams, track, start } = setup(async () => ({ ok: true, jobId: 'srv-1' }));
    await engine.start();
    const id = start();
    await flush();
    engine.watch(id);
    streams[0]!.h.onSnapshot(snapshot({ id: 'srv-1', status: 'failed', error: 'boom' }));
    await flush();
    expect(track.mock.calls.map((c) => c[0])).toEqual([
      'studio_export_started',
      'studio_export_failed',
    ]);
  });
});

describe('studio_export result kind (MA13)', () => {
  const job = (name: string, over: Partial<ConversionJob> = {}): ConversionJob =>
    snapshot({
      id: 'srv-1',
      status: 'completed',
      options: { mode: 'studio_export', format: name.split('.').pop() },
      originalFile: { name, size: 0, type: '' },
      ...over,
    });

  const buildDescriptor = ({ job: j }: { job: ConversionJob }) =>
    describeResult({
      job: j,
      task: jobTaskHint(j),
      mode: j.mode,
      fallbackFileName: jobFallbackFileName(j),
    });

  it('a Darkroom render is a video named after the export; audio-only outputs are audio', () => {
    const v = buildDescriptor({ job: job('Trip cut.mp4') });
    expect(v).toMatchObject({ kind: 'video', fileName: 'Trip cut.mp4' });
    expect(buildDescriptor({ job: job('Trip cut.mov') }).kind).toBe('video');
    expect(buildDescriptor({ job: job('Trip cut.mp3') }).kind).toBe('audio');
    expect(buildDescriptor({ job: job('Trip cut.flac') }).kind).toBe('audio');
    // No name at all: the task still says video.
    expect(
      buildDescriptor({ job: job('', { originalFile: { name: '', size: 0, type: '' } }) }).kind,
    ).toBe('video');
  });
});
