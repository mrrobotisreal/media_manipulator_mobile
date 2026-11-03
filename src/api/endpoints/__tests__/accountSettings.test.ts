import { makeReadyStore } from '@/state/testing';
import { setIdTokenProvider } from '../../authToken';
import { accountSettingsApi as api } from '../accountSettings';
import { historyApi } from '../history';
import { settingsSchema } from '../../schemas/accountSettings';
import { normaliseError } from '../../errors';

const settings = {
  retentionHours: 4320,
  retentionScope: 'all',
  deleteMetadataReports: false,
  historyVisibility: 'full',
  emailAiJobFinished: false,
  emailExpiryDigest: true,
  currency: null,
  updatedAt: '2026-11-01T00:00:00Z',
  limits: { minHours: 24, maxHours: 17520, defaultHours: 4320 },
};

const realFetch = global.fetch;
function reply(body: unknown, status = 200, headers: Record<string, string> = {}) {
  const fn = jest.fn((_url: string, _init: RequestInit) =>
    Promise.resolve({
      status,
      headers: new Headers(headers),
      text: () => Promise.resolve(JSON.stringify(body)),
    }),
  );
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}
afterEach(() => {
  global.fetch = realFetch;
  setIdTokenProvider(() => Promise.resolve(null));
});

describe('account settings endpoints', () => {
  it('settingsSchema accepts responses with and without pushJobFinished', () => {
    expect(settingsSchema.parse(settings).pushJobFinished).toBeUndefined();
    expect(settingsSchema.parse({ ...settings, pushJobFinished: true }).pushJobFinished).toBe(true);
    // a newer API never becomes contract_mismatch
    const r = settingsSchema.parse({ ...settings, aFutureKey: 1 }) as Record<string, unknown>;
    expect(r.aFutureKey).toBe(1);
    expect(settingsSchema.safeParse({ ...settings, historyVisibility: 'weird' }).success).toBe(
      false,
    );
  });

  it('patchSettings invalidates Settings and History', async () => {
    const { store } = await makeReadyStore();
    const fn = reply(settings);
    await store.dispatch(api.endpoints.getSettings.initiate());
    expect(fn).toHaveBeenCalledTimes(1);
    // History query cached too
    reply({ entries: [], total: 0, limit: 50, offset: 0 });
    await store.dispatch(historyApi.endpoints.getHistory.initiate());
    const hist = jest.fn((_u: string, _i: RequestInit) =>
      Promise.resolve({
        status: 200,
        headers: new Headers(),
        text: () => Promise.resolve(JSON.stringify({ ...settings, retentionHours: 168 })),
      }),
    );
    global.fetch = hist as unknown as typeof fetch;
    await store.dispatch(api.endpoints.patchSettings.initiate({ retentionHours: 168 }));
    await new Promise((r) => setTimeout(r, 20));
    const urls = hist.mock.calls.map((c) => `${c[1].method ?? 'GET'} ${c[0]}`);
    expect(urls[0]).toMatch(/^PATCH .*\/account\/settings$/);
    expect(JSON.parse(hist.mock.calls[0]![1].body as string)).toEqual({ retentionHours: 168 });
    // refetches of both tagged queries follow
    expect(urls.some((u) => /GET .*\/account\/settings$/.test(u))).toBe(true);
    expect(urls.some((u) => /GET .*\/account\/history/.test(u))).toBe(true);
  });

  it('previewRetention sends retentionHours and parses the counts', async () => {
    const { store } = await makeReadyStore();
    const fn = reply({
      wouldDelete: { results: 3, projects: 1, other: 0, bytes: 2048 },
      earliestDeletionAt: null,
    });
    const res = await store.dispatch(api.endpoints.previewRetention.initiate(168));
    expect(fn.mock.calls[0]![0]).toMatch(/\/account\/settings\/preview\?retentionHours=168$/);
    expect(res.data?.wouldDelete.results).toBe(3);
  });

  it('deleteAllData sends confirm DELETE', async () => {
    const { store } = await makeReadyStore();
    const fn = reply({ deleted: { objects: 2, bytes: 10, projects: 0, jobs: 2 }, pending: 0 });
    const res = await store.dispatch(api.endpoints.deleteAllData.initiate());
    expect(fn.mock.calls[0]![1].method).toBe('POST');
    expect(JSON.parse(fn.mock.calls[0]![1].body as string)).toEqual({ confirm: 'DELETE' });
    expect(res).toMatchObject({ data: { pending: 0 } });
  });

  it('deleteAccount sends the exact phrase; a 401 reauth_required is its own code', async () => {
    const { store } = await makeReadyStore();
    const fn = reply({ error: 'reauth_required' }, 401);
    const res = await store.dispatch(api.endpoints.deleteAccount.initiate());
    expect(JSON.parse(fn.mock.calls[0]![1].body as string)).toEqual({
      confirm: 'DELETE MY ACCOUNT',
    });
    expect(fn).toHaveBeenCalledTimes(1); // reauth_required is not retried by the 401 refresh
    expect(res.error).toMatchObject({ status: 401, code: 'reauth_required' });
  });

  it('deleteAccount 502 keeps the report in details.report', async () => {
    const report = {
      status: 'incomplete',
      steps: [
        { step: 'stripe', status: 'done' },
        { step: 'sweep', status: 'failed', detail: 'files pending' },
      ],
      deleted: { objects: 1 },
      retryable: true,
      message: 'x',
    };
    const e = normaliseError(502, report);
    expect(e.status).toBe(502);
    expect(e.details.report).toEqual(report);
    expect(e.details.retryable).toBe(true);
    const { store } = await makeReadyStore();
    reply(report, 502);
    const res = await store.dispatch(api.endpoints.deleteAccount.initiate());
    expect((res.error as { details: { report: { status: string } } }).details.report.status).toBe(
      'incomplete',
    );
  });

  it('revokeSessions POSTs and parses revokedAt', async () => {
    const { store } = await makeReadyStore();
    const fn = reply({ revokedAt: '2026-11-03T00:00:00Z' });
    const res = await store.dispatch(api.endpoints.revokeSessions.initiate());
    expect(fn.mock.calls[0]![0]).toMatch(/\/account\/sessions\/revoke$/);
    expect(res).toMatchObject({ data: { revokedAt: '2026-11-03T00:00:00Z' } });
  });
});
