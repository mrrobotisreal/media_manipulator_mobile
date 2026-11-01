import { makeReadyStore } from '@/state/testing';
import { setIdTokenProvider } from './authToken';
import { mmBaseQuery, registerAccountInvalidator } from './baseQuery';

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };

function fakeFetch(replies: Reply[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = jest.fn((url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = replies.shift() ?? { status: 500 };
    return Promise.resolve({
      status: r.status,
      headers: new Headers(r.headers),
      text: () => Promise.resolve(r.body === undefined ? '' : JSON.stringify(r.body)),
    });
  });
  global.fetch = fn as unknown as typeof fetch;
  return { fn, calls };
}

function makeApi() {
  const dispatch = jest.fn();
  const api = {
    dispatch,
    signal: new AbortController().signal,
    getState: () => ({}),
    abort: jest.fn(),
    extra: {},
    endpoint: 'x',
    type: 'query' as const,
    forced: false,
  };
  return { api, dispatch };
}

const realFetch = global.fetch;

describe('mmBaseQuery', () => {
  beforeEach(async () => {
    await makeReadyStore();
    registerAccountInvalidator(() => ({ type: 'test/invalidateAccount' }));
  });
  afterEach(() => {
    global.fetch = realFetch;
    setIdTokenProvider(() => Promise.resolve(null));
    jest.useRealTimers();
  });

  it('returns data and dispatches quota/observed from headers on 2xx', async () => {
    const { calls } = fakeFetch([
      {
        status: 200,
        body: { ok: true },
        headers: {
          'X-MM-Tier': 'free',
          'X-MM-Quota-Limit': '10',
          'X-MM-Quota-Remaining': '7',
          'X-MM-Quota-Reset': '2026-11-02T00:00:00Z',
          'X-MM-Quota-Metric': 'ai_ops',
        },
      },
    ]);
    const { api, dispatch } = makeApi();
    const res = await mmBaseQuery({ url: '/tiers', params: { a: 1 } }, api, {});
    expect(res.data).toEqual({ ok: true });
    expect(calls[0]!.url).toMatch(/\/tiers\?a=1$/);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'quota/observed',
      payload: {
        tier: 'free',
        metric: 'ai_ops',
        limit: 10,
        remaining: 7,
        resetAt: '2026-11-02T00:00:00Z',
      },
    });
  });

  it('defaults the metric to ops when only limit/remaining are present', async () => {
    fakeFetch([
      { status: 200, body: {}, headers: { 'X-MM-Quota-Limit': '5', 'X-MM-Quota-Remaining': '4' } },
    ]);
    const { api, dispatch } = makeApi();
    await mmBaseQuery('/x', api, {});
    expect(dispatch.mock.calls[0][0].payload).toMatchObject({
      metric: 'ops',
      limit: 5,
      remaining: 4,
    });
  });

  it('dispatches nothing when no quota headers exist', async () => {
    fakeFetch([{ status: 200, body: {} }]);
    const { api, dispatch } = makeApi();
    await mmBaseQuery('/x', api, {});
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('401 -> forced refresh -> success', async () => {
    const provider = jest.fn((force: boolean) => Promise.resolve(force ? 'new' : 'old'));
    setIdTokenProvider(provider);
    const { calls } = fakeFetch([
      { status: 401, body: { error: 'Invalid or expired credentials' } },
      { status: 200, body: { ok: 1 } },
    ]);
    const { api, dispatch } = makeApi();
    const res = await mmBaseQuery('/account/me', api, {});
    expect(res.data).toEqual({ ok: 1 });
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer old');
    expect((calls[1]!.init.headers as Record<string, string>).Authorization).toBe('Bearer new');
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'auth/sessionExpired' }),
    );
  });

  it('401 twice -> auth/sessionExpired and unauthenticated', async () => {
    setIdTokenProvider(() => Promise.resolve('t'));
    const { fn } = fakeFetch([
      { status: 401, body: { error: 'Authentication required' } },
      { status: 401, body: { error: 'Authentication required' } },
    ]);
    const { api, dispatch } = makeApi();
    const res = await mmBaseQuery('/account/me', api, {});
    expect(fn).toHaveBeenCalledTimes(2);
    expect(res.error).toMatchObject({ code: 'unauthenticated', status: 401 });
    expect(dispatch).toHaveBeenCalledWith({ type: 'auth/sessionExpired', payload: undefined });
  });

  it('401 reauth_required is not retried and does not expire the session', async () => {
    const { fn } = fakeFetch([{ status: 401, body: { error: 'reauth_required' } }]);
    const { api, dispatch } = makeApi();
    const res = await mmBaseQuery({ url: '/account', method: 'DELETE' }, api, {});
    expect(fn).toHaveBeenCalledTimes(1);
    expect(res.error).toMatchObject({ code: 'reauth_required' });
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'auth/sessionExpired' }),
    );
  });

  it('non-2xx invalidates Account and normalises the error', async () => {
    fakeFetch([
      { status: 429, body: { error: 'quota_exceeded', metric: 'ops', limit: 3, used: 4 } },
    ]);
    const { api, dispatch } = makeApi();
    const res = await mmBaseQuery('/x', api, {});
    expect(res.error).toMatchObject({ code: 'quota_exceeded', status: 429 });
    expect(dispatch).toHaveBeenCalledWith({ type: 'test/invalidateAccount' });
  });

  it('skipAccountInvalidation avoids the refetch loop for Account endpoints', async () => {
    fakeFetch([{ status: 500, body: {} }]);
    const { api, dispatch } = makeApi();
    await mmBaseQuery({ url: '/account/me', skipAccountInvalidation: true }, api, {});
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('serialises JSON bodies with a Content-Type', async () => {
    const { calls } = fakeFetch([{ status: 200, body: {} }]);
    const { api } = makeApi();
    await mmBaseQuery({ url: '/account/sync', method: 'POST', body: { locale: 'en' } }, api, {});
    expect(calls[0]!.init.body).toBe('{"locale":"en"}');
    expect((calls[0]!.init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
  });

  it('fetch failure -> network', async () => {
    global.fetch = jest.fn(() => Promise.reject(new TypeError('Network request failed'))) as never;
    const { api } = makeApi();
    const res = await mmBaseQuery('/x', api, {});
    expect(res.error).toMatchObject({ code: 'network', status: 'FETCH_ERROR' });
  });

  it('abort on timeout -> timeout', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(
      (_u: string, init: RequestInit) =>
        new Promise((_res, rej) => {
          init.signal?.addEventListener('abort', () => rej(new Error('aborted')));
        }),
    ) as never;
    const { api } = makeApi();
    const p = mmBaseQuery({ url: '/x', timeoutMs: 1000 }, api, {});
    await jest.advanceTimersByTimeAsync(1001);
    expect((await p).error).toMatchObject({ code: 'timeout' });
  });
});
