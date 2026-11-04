/**
 * The MA50 starter seam: an Aperture export is created by a JSON request (no upload) and then
 * tracked exactly like an upload job. Also the analytics order for one export (acceptance 6):
 * photo_export_started -> job_started -> job_completed -> photo_export_completed.
 */
import type { ConversionJob } from '@/api/schemas/job';
import type { MmError } from '@/api/errors';
import { track } from '@/analytics/track';
import { trackPhotoExportSettled, trackPhotoExportStarted } from '@/analytics/photoEvents';
import type { IntakeFile } from '@/files/types';
import { exportBody, exportOptionsHash } from '@/photo/exportPlan';
import { upsertAdjustment } from '@/photo/layerOps';
import { newPhotoDoc } from '@/photo/photoTypes';
import { createJobEngine, type JobEngineDeps, type JobStore } from '../jobEngine';
import {
  makePhotoExportStarter,
  photoExportOptions,
  PHOTO_EXPORT_STARTER,
  type ExportCall,
} from '../starters/photoExport';
import type { EventHandlers, JobTransport } from '../transport';
import type { JobRecord } from '../types';
import { snapshot } from '../testFixtures';

jest.mock('@/analytics/track', () => ({ track: jest.fn() }));
const tracked = () => (track as jest.Mock).mock.calls.map((c) => c[0] as string);

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const doc = upsertAdjustment(newPhotoDoc(4032, 3024), 'exposure', (p) => ({ ...p, ev: 1 })).doc;
const source: IntakeFile = {
  id: 'photo:p1',
  uri: 'file:///cache/intake/i1/IMG_1.jpg',
  name: 'IMG_1.jpg',
  extension: 'jpg',
  mimeType: 'image/jpeg',
  mediaKind: 'image',
  sizeBytes: 3_000_000,
  source: 'picker',
  copiedAt: 0,
};
const tool = {
  id: 'aperture',
  family: 'image' as const,
  analyticsSlug: 'aperture',
  endpoint: 'photoProject' as const,
  optionsBuilder: (f: Record<string, unknown>) => f,
};

function setup(call: ExportCall) {
  const records = new Map<string, JobRecord>();
  const store: JobStore = {
    get: (id) => records.get(id),
    all: () => [...records.values()],
    put: (r) => void records.set(r.localId, r),
  };
  const streams: { jobId: string; h: EventHandlers }[] = [];
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
  const files = { exists: jest.fn(() => false), release: jest.fn(), keepOriginal: jest.fn() };
  const deps: JobEngineDeps = {
    transport,
    store,
    now: () => 5_000,
    appState: { current: () => 'active', subscribe: () => () => undefined },
    network: { subscribe: () => () => undefined },
    files,
    onSettled: () => undefined,
    activation: { uid: () => null, signupAt: () => null, claim: async () => false },
    newId: () => 'n1',
    starters: {
      [PHOTO_EXPORT_STARTER]: makePhotoExportStarter(call, {
        settled: (r) => trackPhotoExportSettled(r, 9_000),
      }),
    },
  };
  const engine = createJobEngine(deps);
  return { engine, records, streams, files };
}

const start = (engine: ReturnType<typeof createJobEngine>) => {
  const body = exportBody(
    doc,
    { format: 'jpg', quality: 92, metadataMode: 'keep', maxSize: 0 },
    'IMG_1',
  );
  trackPhotoExportStarted(doc, 'jpg', 12.2);
  return engine.startJobs([
    {
      tool,
      file: source,
      starter: PHOTO_EXPORT_STARTER,
      options: photoExportOptions({ projectId: 'p1', revision: 3, body, megapixels: 12.2 }),
      optionsHash: exportOptionsHash(doc, 'jpg', 12.2),
    },
  ])[0]!;
};

beforeEach(() => (track as jest.Mock).mockClear());

describe('photoExport starter on the job engine', () => {
  it('posts the export (no upload), then tracks the job; events in order', async () => {
    const calls: Parameters<ExportCall>[0][] = [];
    const { engine, records, streams, files } = setup(async (a) => {
      calls.push(a);
      return { ok: true, jobId: 'srv-1' };
    });
    await engine.start();
    const id = start(engine);
    await flush();
    expect(calls).toEqual([
      {
        id: 'p1',
        revision: 3,
        body: { doc, format: 'jpg', quality: 92, metadataMode: 'keep', name: 'IMG_1' },
      },
    ]);
    const rec = records.get(id)!;
    expect(rec).toMatchObject({
      state: 'pending',
      jobId: 'srv-1',
      transport: 'starter',
      starter: 'photoExport',
      optionsHash: '1l-0m-jpg-<=16',
    });
    expect(files.exists).not.toHaveBeenCalled(); // no cached-copy check for a starter
    expect(files.release).not.toHaveBeenCalled(); // the editor still owns its source file

    engine.watch(id);
    const done: ConversionJob = snapshot({
      id: 'srv-1',
      status: 'completed',
      resultFileName: 'IMG_1 (retouched).jpg',
      resultSizeBytes: 4_200_000,
    });
    streams[0]!.h.onSnapshot(done);
    await flush();
    expect(records.get(id)!.state).toBe('completed');
    expect(files.release).not.toHaveBeenCalled();
    expect(files.keepOriginal).toHaveBeenCalledTimes(1); // runtime copies (not moves) for starters
    const order = tracked().filter((n) => n !== 'activation_first_job_completed');
    expect(order).toEqual([
      'photo_export_started',
      'job_started',
      'job_completed',
      'photo_export_completed',
    ]);
    expect(tracked()).not.toContain('upload_started');
    const completed = (track as jest.Mock).mock.calls.find(
      (c) => c[0] === 'photo_export_completed',
    )!;
    expect(completed[1]).toEqual({
      format: 'jpg',
      megapixels_bucket: '<=16',
      ms: '1-5s',
      bytes_bucket: '1-10mb',
    });
    expect(completed[2]).toMatchObject({ tool_slug: 'aperture', job_id: 'srv-1' });
  });

  it('a refused export (402/403/429) is rejected with the API error and reports photo_export_failed', async () => {
    const err: MmError = { status: 429, code: 'quota_exceeded', details: { metric: 'ops' } };
    const { engine, records, files } = setup(async () => ({ ok: false, error: err }));
    await engine.start();
    const id = start(engine);
    await flush();
    expect(records.get(id)).toMatchObject({ state: 'rejected', error: err });
    expect(files.release).not.toHaveBeenCalled();
    expect(tracked()).toEqual(['photo_export_started', 'photo_export_failed']);
    expect((track as jest.Mock).mock.calls[1][1]).toMatchObject({ reason: 'quota' });
  });

  it('a network failure is retryable and the retry re-sends the same request', async () => {
    let n = 0;
    const { engine, records } = setup(async () =>
      ++n === 1
        ? { ok: false, error: { status: 'FETCH_ERROR', code: 'network', details: {} } }
        : { ok: true, jobId: 'srv-1' },
    );
    await engine.start();
    const id = start(engine);
    await flush();
    expect(records.get(id)!.state).toBe('upload_failed');
    expect(engine.retry(id)).toBe(true);
    await flush();
    expect(records.get(id)).toMatchObject({ state: 'pending', jobId: 'srv-1' });
  });

  it('a server-side failure reports photo_export_failed with reason render', async () => {
    const { engine, records, streams } = setup(async () => ({ ok: true, jobId: 'srv-1' }));
    await engine.start();
    const id = start(engine);
    await flush();
    engine.watch(id);
    streams[0]!.h.onSnapshot(snapshot({ id: 'srv-1', status: 'failed', error: 'Export failed' }));
    await flush();
    expect(records.get(id)!.state).toBe('failed');
    const failed = (track as jest.Mock).mock.calls.find((c) => c[0] === 'photo_export_failed')!;
    expect(failed[1]).toMatchObject({ reason: 'render' });
  });

  it('refuses an unknown starter and a photoProject tool without one', () => {
    const { engine } = setup(async () => ({ ok: true, jobId: 'x' }));
    expect(() => engine.startJobs([{ tool, file: source, options: {}, starter: 'nope' }])).toThrow(
      'unknown job starter',
    );
    expect(() => engine.startJobs([{ tool, file: source, options: {} }])).toThrow('Aperture');
  });
});
