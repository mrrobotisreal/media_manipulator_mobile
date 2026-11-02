import type { ConversionJob } from '@/api/schemas/job';
import type { MmError } from '@/api/errors';
import { track } from '@/analytics/track';
import type { IntakeFile } from '@/files/types';
import { getTool } from '@/tools/registry';
import {
  createJobEngine,
  LIST_POLL_MS,
  PROGRESS_THROTTLE_MS,
  SSE_POLL_MS,
  SSE_SILENCE_MS,
  type JobEngineDeps,
  type JobStore,
} from '../jobEngine';
import type { EventHandlers, JobTransport, UploadOutcome } from '../transport';
import type { JobRecord } from '../types';
import { snapshot } from '../testFixtures';

jest.mock('@/analytics/track', () => ({ track: jest.fn() }));

type FetchResult = { ok: true; job: ConversionJob } | { ok: false; error: MmError };
const notFound: FetchResult = {
  ok: false,
  error: { status: 404, code: 'not_found', details: {} },
};
const ok = (job: ConversionJob): FetchResult => ({ ok: true, job });
const S = (over: Partial<ConversionJob> = {}) => snapshot({ id: 'srv-1', ...over });

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const file = (n = 1, over: Partial<IntakeFile> = {}): IntakeFile => ({
  id: `i${n}`,
  uri: `file:///cache/intake/i${n}/p.jpg`,
  name: 'p.jpg',
  extension: 'jpg',
  mimeType: 'image/jpeg',
  mediaKind: 'image',
  sizeBytes: 1000,
  source: 'picker',
  copiedAt: 0,
  ...over,
});

function setup(opts: { seed?: JobRecord[] } = {}) {
  let t = 1_000_000;
  const records = new Map<string, JobRecord>((opts.seed ?? []).map((r) => [r.localId, r]));
  const store: JobStore = {
    get: (id) => records.get(id),
    all: () => [...records.values()],
    put: (r) => void records.set(r.localId, r),
  };

  const uploads: {
    deferred: ReturnType<typeof deferred<UploadOutcome>>;
    onProgress: (f: number) => void;
    signal: AbortSignal;
  }[] = [];
  const fetchQueue: FetchResult[] = [];
  const fetchCalls: string[] = [];
  const streams: { jobId: string; h: EventHandlers; closed: boolean }[] = [];

  const transport: JobTransport = {
    uploadMultipart: (_s, onProgress, signal) => {
      const d = deferred<UploadOutcome>();
      uploads.push({ deferred: d, onProgress, signal });
      return d.promise;
    },
    presign: () =>
      Promise.resolve({
        ok: true as const,
        target: { uploadUrl: 'https://s3/x', s3Key: 'k', expiresAt: 'x' },
      }),
    putBinary: (_t, _s, onProgress, signal) => {
      const d = deferred<UploadOutcome>();
      uploads.push({ deferred: d, onProgress, signal });
      return d.promise.then((o) => (o.ok ? { ok: true as const } : o));
    },
    completePresign: () => Promise.resolve({ ok: true as const, jobId: 'srv-1' }),
    fetchJob: (id) => {
      fetchCalls.push(id);
      return Promise.resolve(fetchQueue.shift() ?? ok(S({ status: 'pending' })));
    },
    openJobEvents: (jobId, h) => {
      const s = { jobId, h, closed: false };
      streams.push(s);
      return { close: () => void (s.closed = true) };
    },
  };

  let appState: 'active' | 'background' = 'active';
  const appSubs: ((s: string) => void)[] = [];
  const netSubs: ((c: boolean) => void)[] = [];
  const keep = { activate: jest.fn(), release: jest.fn() };
  const filesApi = {
    exists: jest.fn(() => true),
    release: jest.fn(),
    keepOriginal: jest.fn(),
  };
  const settled: string[] = [];
  const claimed = new Set<string>();
  let n = 0;

  const deps: JobEngineDeps = {
    transport,
    store,
    now: () => t,
    appState: {
      current: () => appState,
      subscribe: (cb) => {
        appSubs.push(cb);
        return () => void appSubs.splice(appSubs.indexOf(cb), 1);
      },
    },
    network: {
      subscribe: (cb) => {
        netSubs.push(cb);
        return () => void netSubs.splice(netSubs.indexOf(cb), 1);
      },
    },
    keepAwake: keep,
    files: filesApi,
    onSettled: (r) => void settled.push(`${r.localId}:${r.state}`),
    activation: {
      uid: () => 'uid-1',
      signupAt: () => t - 2 * 3_600_000,
      claim: (uid) => {
        if (claimed.has(uid)) return Promise.resolve(false);
        claimed.add(uid);
        return Promise.resolve(true);
      },
    },
    newId: () => `n${++n}`,
  };
  const engine = createJobEngine(deps);

  return {
    engine,
    records,
    uploads,
    fetchQueue,
    fetchCalls,
    streams,
    keep,
    filesApi,
    settled,
    advance: (ms: number) => {
      t += ms;
      return jest.advanceTimersByTimeAsync(ms);
    },
    setApp(s: 'active' | 'background') {
      appState = s;
      appSubs.forEach((cb) => cb(s));
    },
    net: (c: boolean) => netSubs.forEach((cb) => cb(c)),
    rec: (id = 'local_n1') => records.get(id)!,
    start: (f = file(), toolId = 'image-convert') =>
      engine.startJobs([{ tool: getTool(toolId)!, file: f, options: { format: 'png' } }])[0]!,
  };
}

const events = () =>
  (track as jest.Mock).mock.calls.map(([name, props, ctx]) => ({ name, props, ctx }));
const names = () => events().map((e) => e.name);

beforeEach(() => {
  jest.useFakeTimers();
  (track as jest.Mock).mockClear();
});
afterEach(() => jest.useRealTimers());

describe('happy paths', () => {
  it('multipart: queued -> uploading -> pending -> SSE snapshots -> completed, with analytics in order', async () => {
    const s = setup();
    await s.engine.start();
    const id = s.start();
    await flush();
    expect(id).toBe('local_n1');
    expect(s.rec().state).toBe('uploading');
    expect(s.rec().transport).toBe('post');
    expect(s.keep.activate).toHaveBeenCalled();

    s.uploads[0]!.deferred.resolve({ ok: true, jobId: 'srv-1' });
    await flush();
    expect(s.rec()).toMatchObject({ state: 'pending', jobId: 'srv-1' });
    s.engine.watch(id);
    expect(s.streams).toHaveLength(1);
    expect(s.engine.trackingKind(id)).toBe('sse');

    s.streams[0]!.h.onSnapshot(S({ status: 'processing', progress: 40, currentStage: 'encode' }));
    expect(s.rec()).toMatchObject({ state: 'processing', progress: 40, stage: 'encode' });
    await s.advance(5000);
    s.streams[0]!.h.onSnapshot(
      S({
        status: 'completed',
        resultFileName: 'out.png',
        resultSizeBytes: 500,
        queueWaitMs: 1200,
      }),
    );
    await flush();

    expect(s.rec().state).toBe('completed');
    expect(s.streams[0]!.closed).toBe(true);
    expect(s.settled).toEqual(['local_n1:completed']);
    expect(s.filesApi.keepOriginal).toHaveBeenCalledTimes(1);
    expect(s.keep.release).toHaveBeenCalled();

    expect(names()).toEqual([
      'upload_started',
      'upload_completed',
      'job_started',
      'job_completed',
      'activation_first_job_completed',
    ]);
    const [us, uc, js, jc, act] = events();
    expect(us!.props).toEqual({ size_bytes: 1000, transport: 'post' });
    expect(us!.ctx).toMatchObject({ tool_slug: 'image-converter', media_kind: 'image' });
    expect(uc!.props).toMatchObject({
      size_bytes: 1000,
      transport: 'post',
      duration_ms: expect.any(Number),
    });
    expect(js!.props).toMatchObject({
      job_id: 'srv-1',
      target_format: 'png',
      source_format: 'jpg',
      options_hash: expect.stringMatching(/^[0-9a-f]{8}$/),
    });
    expect(js!.ctx).toMatchObject({ job_id: 'srv-1', tool_slug: 'image-converter' });
    expect(jc!.props).toEqual({
      job_id: 'srv-1',
      duration_ms: 5000,
      output_bytes: 500,
      output_format: 'png',
      queue_wait_ms: 1200,
    });
    expect(act!.props).toEqual({
      tool_slug: 'image-converter',
      media_kind: 'image',
      hours_since_signup: '1-24h',
      guest: false,
    });
  });

  it('activation fires once per uid across jobs', async () => {
    const s = setup();
    await s.engine.start();
    for (const n of [1, 2]) {
      s.start(file(n));
      await flush();
      s.uploads[n - 1]!.deferred.resolve({ ok: true, jobId: `srv-${n}` });
      await flush();
      s.fetchQueue.push(ok(S({ id: `srv-${n}`, status: 'completed' })));
      await s.advance(LIST_POLL_MS);
      await flush();
    }
    expect(names().filter((x) => x === 'activation_first_job_completed')).toHaveLength(1);
    expect(names().filter((x) => x === 'job_completed')).toHaveLength(2);
  });

  it('presigned: video goes presign -> PUT -> finalizing -> pending and reports transport presigned_put', async () => {
    const s = setup();
    await s.engine.start();
    const id = s.start(
      file(1, { extension: 'mp4', mimeType: 'video/mp4', mediaKind: 'video', name: 'c.mp4' }),
      'video-convert',
    );
    await flush();
    expect(s.rec().transport).toBe('presigned_put');
    s.uploads[0]!.deferred.resolve({ ok: true, jobId: 'ignored' });
    await flush();
    expect(s.rec(id)).toMatchObject({ state: 'pending', jobId: 'srv-1' });
    expect(names().slice(0, 3)).toEqual(['upload_started', 'upload_completed', 'job_started']);
    expect(events()[0]!.props).toMatchObject({ transport: 'presigned_put' });
    // not an image: the intake copy is released as soon as the job is accepted
    expect(s.filesApi.release).toHaveBeenCalledWith('i1');
  });
});

describe('upload queue', () => {
  it('throttles progress to 4/s and always delivers 100%', async () => {
    const s = setup();
    await s.engine.start();
    s.start();
    await flush();
    const up = s.uploads[0]!;
    up.onProgress(0.1);
    up.onProgress(0.2);
    up.onProgress(0.3);
    expect(s.rec().uploadProgress).toBe(0.1);
    await s.advance(PROGRESS_THROTTLE_MS);
    up.onProgress(0.5);
    expect(s.rec().uploadProgress).toBe(0.5);
    up.onProgress(1);
    expect(s.rec().uploadProgress).toBe(1);
  });

  it('runs one upload at a time, FIFO, and releases keep-awake when the queue drains', async () => {
    const s = setup();
    await s.engine.start();
    const ids = s.engine.startJobs([
      { tool: getTool('image-convert')!, file: file(1), options: {} },
      { tool: getTool('image-convert')!, file: file(2), options: {} },
    ]);
    await flush();
    expect(s.rec(ids[0]).state).toBe('uploading');
    expect(s.rec(ids[1]).state).toBe('queued');
    expect(s.uploads).toHaveLength(1);
    s.uploads[0]!.deferred.resolve({ ok: true, jobId: 'a' });
    await flush();
    expect(s.rec(ids[1]).state).toBe('uploading');
    expect(s.uploads).toHaveLength(2);
    expect(s.keep.release).not.toHaveBeenCalled();
    s.uploads[1]!.deferred.resolve({ ok: true, jobId: 'b' });
    await flush();
    expect(s.keep.release).toHaveBeenCalled();
  });

  it('cancel while uploading aborts the task, marks cancelled, and starts the next job', async () => {
    const s = setup();
    await s.engine.start();
    const ids = s.engine.startJobs([
      { tool: getTool('image-convert')!, file: file(1), options: {} },
      { tool: getTool('image-convert')!, file: file(2), options: {} },
    ]);
    await flush();
    s.engine.cancel(ids[0]!);
    expect(s.uploads[0]!.signal.aborted).toBe(true);
    expect(s.rec(ids[0]).state).toBe('cancelled');
    s.uploads[0]!.deferred.resolve({
      ok: false,
      kind: 'cancelled',
      reason: 'cancelled',
      error: { status: 'FETCH_ERROR', code: 'network', details: {} },
    });
    await flush();
    expect(s.rec(ids[1]).state).toBe('uploading');
    expect(events().find((e) => e.name === 'upload_failed')!.props).toMatchObject({
      reason: 'cancelled',
    });
    expect(names().filter((n) => n === 'job_started')).toHaveLength(0);
    // a queued job cancels without ever touching the transport
    s.engine.cancel(ids[1]!);
    expect(s.rec(ids[1]).state).toBe('cancelled');
  });

  it('quota refusal becomes rejected and releases the copy; a network failure is retryable', async () => {
    const s = setup();
    await s.engine.start();
    const a = s.start(file(1));
    await flush();
    const err: MmError = { status: 429, code: 'quota_exceeded', details: {} };
    s.uploads[0]!.deferred.resolve({
      ok: false,
      kind: 'rejected',
      error: err,
      reason: 'quota_exceeded',
      status: 429,
    });
    await flush();
    expect(s.rec(a)).toMatchObject({ state: 'rejected', error: { code: 'quota_exceeded' } });
    expect(s.filesApi.release).toHaveBeenCalledWith('i1');

    const b = s.start(file(2));
    await flush();
    s.uploads[1]!.deferred.resolve({
      ok: false,
      kind: 'failed',
      reason: 'network',
      error: { status: 'FETCH_ERROR', code: 'network', details: {} },
    });
    await flush();
    expect(s.rec(b).state).toBe('upload_failed');
    expect(
      events()
        .filter((e) => e.name === 'upload_failed')
        .map((e) => e.props!.reason),
    ).toEqual(['quota_exceeded', 'network']);
    // Try again re-uploads from the cached copy
    expect(s.engine.retry(b)).toBe(true);
    await flush();
    expect(s.rec(b).state).toBe('uploading');
    expect(s.uploads).toHaveLength(3);
  });

  it('retry is refused when the cache copy was swept', async () => {
    const s = setup();
    await s.engine.start();
    const id = s.start();
    await flush();
    s.uploads[0]!.deferred.resolve({
      ok: false,
      kind: 'failed',
      reason: 'network',
      error: { status: 'FETCH_ERROR', code: 'network', details: {} },
    });
    await flush();
    s.filesApi.exists.mockReturnValue(false);
    expect(s.engine.retry(id)).toBe(false);
    expect(s.rec(id)).toMatchObject({ state: 'upload_failed', error: { code: 'file_gone' } });
  });

  it('a missing cached copy fails as file_gone before any upload, not as a network error', async () => {
    const s = setup();
    await s.engine.start();
    s.filesApi.exists.mockReturnValue(false);
    const id = s.start();
    await flush();
    expect(s.uploads).toHaveLength(0);
    expect(s.rec(id)).toMatchObject({ state: 'upload_failed', error: { code: 'file_gone' } });
  });
});

describe('tracking', () => {
  async function accepted(s: ReturnType<typeof setup>, watch = true) {
    await s.engine.start();
    const id = s.start();
    await flush();
    s.uploads[0]!.deferred.resolve({ ok: true, jobId: 'srv-1' });
    await flush();
    if (watch) s.engine.watch(id);
    return id;
  }

  it('SSE error falls back to 2 s polling', async () => {
    const s = setup();
    const id = await accepted(s);
    s.streams[0]!.h.onError({ status: 'FETCH_ERROR', code: 'network', details: {} });
    expect(s.streams[0]!.closed).toBe(true);
    expect(s.engine.trackingKind(id)).toBe('poll2');
    expect(s.fetchCalls).toHaveLength(1);
    s.fetchQueue.push(ok(S({ status: 'processing', progress: 10 })));
    await s.advance(SSE_POLL_MS);
    await s.advance(SSE_POLL_MS);
    expect(s.fetchCalls.length).toBeGreaterThanOrEqual(3);
    s.fetchQueue.push(ok(S({ status: 'completed' })));
    await s.advance(SSE_POLL_MS);
    expect(s.rec().state).toBe('completed');
    const n = s.fetchCalls.length;
    await s.advance(10_000);
    expect(s.fetchCalls).toHaveLength(n);
  });

  it('60 s of SSE silence falls back to polling; keepalives reset the timer', async () => {
    const s = setup();
    const id = await accepted(s);
    await s.advance(SSE_SILENCE_MS - 1000);
    s.streams[0]!.h.onActivity();
    await s.advance(SSE_SILENCE_MS - 1000);
    expect(s.engine.trackingKind(id)).toBe('sse');
    await s.advance(2000);
    expect(s.engine.trackingKind(id)).toBe('poll2');
    expect(s.streams[0]!.closed).toBe(true);
  });

  it('a stream that closes before the terminal snapshot falls back to polling', async () => {
    const s = setup();
    const id = await accepted(s);
    s.streams[0]!.h.onClose();
    expect(s.engine.trackingKind(id)).toBe('poll2');
  });

  it('unwatched jobs poll every 5 s; watching switches to SSE and unwatching back', async () => {
    const s = setup();
    const id = await accepted(s, false);
    expect(s.engine.trackingKind(id)).toBe('poll5');
    const before = s.fetchCalls.length;
    await s.advance(LIST_POLL_MS);
    expect(s.fetchCalls.length).toBeGreaterThan(before);
    s.engine.watch(id);
    expect(s.engine.trackingKind(id)).toBe('sse');
    const n = s.fetchCalls.length;
    await s.advance(LIST_POLL_MS * 2);
    expect(s.fetchCalls).toHaveLength(n);
    s.engine.unwatch(id);
    expect(s.engine.trackingKind(id)).toBe('poll5');
    expect(s.streams[0]!.closed).toBe(true);
  });

  it('background stops SSE and polling but keeps the upload running', async () => {
    const s = setup();
    await s.engine.start();
    const id1 = s.start(file(1));
    await flush();
    s.uploads[0]!.deferred.resolve({ ok: true, jobId: 'srv-1' });
    await flush();
    s.engine.watch(id1);
    const id2 = s.start(file(2));
    await flush();
    expect(s.rec(id2).state).toBe('uploading');

    s.setApp('background');
    expect(s.streams[0]!.closed).toBe(true);
    expect(s.engine.trackingKind(id1)).toBeNull();
    const calls = s.fetchCalls.length;
    await s.advance(60_000);
    expect(s.fetchCalls).toHaveLength(calls);
    expect(s.uploads[1]!.signal.aborted).toBe(false);
    expect(s.rec(id2).state).toBe('uploading');
    s.uploads[1]!.deferred.resolve({ ok: true, jobId: 'srv-2' });
    await flush();
    // accepted in the background: no tracking started
    expect(s.rec(id2).state).toBe('pending');
    expect(s.engine.trackingKind(id2)).toBeNull();
  });

  it('foreground refetches every non-terminal job once and resumes SSE for the watched one', async () => {
    const s = setup();
    const id = await accepted(s);
    s.setApp('background');
    const before = s.fetchCalls.length;
    s.fetchQueue.push(ok(S({ status: 'processing', progress: 70 })));
    s.setApp('active');
    await flush();
    expect(s.fetchCalls.length).toBe(before + 1);
    expect(s.rec(id).progress).toBe(70);
    expect(s.engine.trackingKind(id)).toBe('sse');
    expect(s.streams).toHaveLength(2);
  });

  it('a job that finished while backgrounded completes on foreground', async () => {
    const s = setup();
    const id = await accepted(s);
    s.setApp('background');
    s.fetchQueue.push(ok(S({ status: 'completed' })));
    s.setApp('active');
    await flush();
    expect(s.rec(id).state).toBe('completed');
    expect(s.engine.trackingKind(id)).toBeNull();
  });

  it('network reconnect refetches while foregrounded and is ignored in the background', async () => {
    const s = setup();
    await accepted(s);
    const n = s.fetchCalls.length;
    s.net(true);
    await flush();
    expect(s.fetchCalls.length).toBe(n + 1);
    s.setApp('background');
    s.net(true);
    await flush();
    expect(s.fetchCalls.length).toBe(n + 1);
  });

  it('404 while tracking marks the job lost', async () => {
    const s = setup();
    const id = await accepted(s);
    s.streams[0]!.h.onError({ status: 404, code: 'not_found', details: {} });
    expect(s.rec(id)).toMatchObject({ state: 'lost', lostReason: 'server_restarted' });
    expect(s.engine.trackingKind(id)).toBeNull();
  });

  it('failed job: settled for Account refresh, job_failed has a fixed reason and the stage', async () => {
    const s = setup();
    const id = await accepted(s);
    s.streams[0]!.h.onSnapshot(
      S({ status: 'failed', error: 'secret p.jpg broke', currentStage: 'encode' }),
    );
    await flush();
    expect(s.rec(id).state).toBe('failed');
    expect(s.settled).toEqual([`${id}:failed`]);
    const failed = events().find((e) => e.name === 'job_failed')!;
    expect(failed.props).toMatchObject({
      job_id: 'srv-1',
      reason: 'processing_failed',
      stage: 'encode',
    });
    expect(JSON.stringify(failed)).not.toContain('p.jpg');
    expect(names()).not.toContain('activation_first_job_completed');
    expect(s.filesApi.release).toHaveBeenCalledWith('i1');
  });

  it('stop watching ends tracking, keeps the job running server-side, and never fires job_completed', async () => {
    const s = setup();
    const id = await accepted(s);
    s.engine.stopWatching(id);
    expect(s.rec(id).state).toBe('stopped');
    expect(s.streams[0]!.closed).toBe(true);
    expect(s.engine.trackingKind(id)).toBeNull();
    await s.advance(30_000);
    expect(names()).not.toContain('job_completed');
  });
});

describe('restore', () => {
  const persisted = (over: Partial<JobRecord>): JobRecord => ({
    localId: 'local_p',
    jobId: 'srv-p',
    toolId: 'image-convert',
    family: 'image',
    analyticsSlug: 'image-converter',
    transport: 'post',
    intakeFileId: 'ip',
    fileUri: 'file:///x',
    fileName: 'x.jpg',
    mimeType: 'image/jpeg',
    sourceExtension: 'jpg',
    sizeBytes: 1,
    mediaKind: 'image',
    options: {},
    optionsHash: 'aaaaaaaa',
    state: 'processing',
    uploadProgress: 1,
    progress: 10,
    createdAt: 1_000_000 - 1000,
    acceptedAt: 1_000_000 - 1000,
    watch: false,
    ...over,
  });

  it('200 applies the server state', async () => {
    const s = setup({ seed: [persisted({})] });
    s.fetchQueue.push(ok(S({ id: 'srv-p', status: 'completed' })));
    await s.engine.start();
    expect(s.rec('local_p').state).toBe('completed');
    expect(names()).toContain('job_completed');
  });

  it('404 within 24 h is lost (server_restarted); older is lost (expired)', async () => {
    const s = setup({
      seed: [
        persisted({}),
        persisted({
          localId: 'local_old',
          jobId: 'srv-old',
          acceptedAt: 1_000_000 - 25 * 3_600_000,
        }),
      ],
    });
    s.fetchQueue.push(notFound, notFound);
    await s.engine.start();
    expect(s.rec('local_p')).toMatchObject({ state: 'lost', lostReason: 'server_restarted' });
    expect(s.rec('local_old')).toMatchObject({ state: 'lost', lostReason: 'expired' });
  });

  it('completed records are not re-fetched; surviving jobs resume 5 s polling', async () => {
    const s = setup({
      seed: [persisted({ localId: 'local_c', jobId: 'srv-c', state: 'completed' }), persisted({})],
    });
    await s.engine.start();
    expect(s.fetchCalls).toEqual(['srv-p']);
    expect(s.engine.trackingKind('local_p')).toBe('poll5');
    expect(s.engine.trackingKind('local_c')).toBeNull();
  });

  it('a transient restore error leaves the job for the normal poll loop', async () => {
    const s = setup({ seed: [persisted({})] });
    s.fetchQueue.push({
      ok: false,
      error: { status: 'FETCH_ERROR', code: 'network', details: {} },
    });
    await s.engine.start();
    expect(s.rec('local_p').state).toBe('processing');
    expect(s.engine.trackingKind('local_p')).toBe('poll5');
  });
});
