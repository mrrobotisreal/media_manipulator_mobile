import { accountApi } from '@/api/endpoints/account';
import type { IntakeFile } from '@/files/types';
import { createJobEngine, type JobEngineDeps } from '@/jobs/jobEngine';
import type { JobTransport } from '@/jobs/transport';
import type { JobRecord } from '@/jobs/types';
import { observed } from '@/state/slices/quota';
import { makeReadyStore } from '@/state/testing';
import { getTool } from '@/tools/registry';
import { makeBeforeUpload, quotaRefusal } from '../quotaGuard';
import { SNAPSHOT } from '../testFixtures';

jest.mock('@/analytics/track', () => ({ track: jest.fn() }));

const NOW = Date.parse('2026-11-02T12:00:00Z');
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const file: IntakeFile = {
  id: 'i1',
  uri: 'file:///cache/intake/i1/p.jpg',
  name: 'p.jpg',
  extension: 'jpg',
  mimeType: 'image/jpeg',
  mediaKind: 'image',
  sizeBytes: 1000,
  source: 'picker',
  copiedAt: 0,
};

async function setup(opts: { usage?: Record<string, number>; headers?: boolean; seed?: boolean }) {
  const { store } = await makeReadyStore();
  if (opts.seed !== false) {
    await store.dispatch(
      accountApi.util.upsertQueryData('getAccountMe', undefined, {
        tier: 'free',
        emailVerified: true,
        anonymous: false,
        limits: SNAPSHOT.limits,
        usage: opts.usage ?? {},
        resetsAt: SNAPSHOT.resetsAt,
      }),
    );
  }
  const uploadMultipart = jest.fn(() => new Promise<never>(() => undefined));
  const records = new Map<string, JobRecord>();
  const transport = { uploadMultipart } as unknown as JobTransport;
  const deps = {
    transport,
    store: {
      get: (id: string) => records.get(id),
      all: () => [...records.values()],
      put: (r: JobRecord) => void records.set(r.localId, r),
    },
    now: () => NOW,
    appState: { current: () => 'active', subscribe: () => () => undefined },
    network: { subscribe: () => () => undefined },
    files: { exists: () => true, release: jest.fn(), keepOriginal: jest.fn() },
    onSettled: jest.fn(),
    activation: { uid: () => null, signupAt: () => null, claim: async () => false },
    beforeUpload: makeBeforeUpload(store.getState, () => NOW),
    newId: () => 'n1',
  } as unknown as JobEngineDeps;
  const engine = createJobEngine(deps);
  return { store, engine, records, uploadMultipart };
}

const start = (engine: ReturnType<typeof createJobEngine>) =>
  engine.startJobs([{ tool: getTool('image-convert')!, file, options: { format: 'png' } }]);

describe('Start pre-flight (beforeUpload)', () => {
  it('remaining 0 rejects with a local quota_exceeded and never calls upload', async () => {
    const s = await setup({ usage: { ops: 30 } });
    start(s.engine);
    await flush();
    expect(s.uploadMultipart).not.toHaveBeenCalled();
    expect(s.records.get('local_n1')).toMatchObject({
      state: 'rejected',
      error: { code: 'quota_exceeded', status: 429, details: { metric: 'ops', limit: 30 } },
    });
  });

  it('a newer header at zero also blocks', async () => {
    const s = await setup({ usage: { ops: 3 } });
    s.store.dispatch(
      observed({
        tier: 'free',
        metric: 'ops',
        limit: 30,
        remaining: 0,
        resetAt: SNAPSHOT.resetsAt,
      }),
    );
    expect(quotaRefusal(s.store.getState(), 'ops', NOW)).not.toBeNull();
  });

  it('remaining above 0 proceeds to the upload', async () => {
    const s = await setup({ usage: { ops: 29 } });
    start(s.engine);
    await flush();
    expect(s.uploadMultipart).toHaveBeenCalledTimes(1);
  });

  it('unknown allowance proceeds (the server stays the authority)', async () => {
    const s = await setup({ seed: false });
    start(s.engine);
    await flush();
    expect(s.uploadMultipart).toHaveBeenCalledTimes(1);
  });

  it('an expired snapshot is not trusted', async () => {
    const s = await setup({ usage: { ops: 30 } });
    expect(quotaRefusal(s.store.getState(), 'ops', Date.parse('2026-11-04T00:00:00Z'))).toBeNull();
  });

  it('metric null never blocks', async () => {
    const s = await setup({ usage: { ops: 30 } });
    expect(quotaRefusal(s.store.getState(), null, NOW)).toBeNull();
  });
});
