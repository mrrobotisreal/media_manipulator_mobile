import { makeReadyStore } from '@/state/testing';
import { localeSet } from '@/state/slices/settings';
import { setIdTokenProvider } from './authToken';
import { buildHeaders } from './baseQuery';

describe('buildHeaders', () => {
  afterEach(() => setIdTokenProvider(() => Promise.resolve(null)));

  it('omits Authorization without a token and carries identity headers', async () => {
    const { store } = await makeReadyStore();
    const h = await buildHeaders();
    const { visitorId, sessionId } = store.getState().session;
    expect(h.Authorization).toBeUndefined();
    expect(h['X-MM-Session-ID']).toBe(sessionId);
    expect(h['X-MM-Visitor-ID']).toBe(visitorId);
    expect(h['User-Agent']).toMatch(/^MediaManipulator\//);
    expect(h['User-Agent']).not.toMatch(/okhttp/i);
    expect(h.Accept).toBe('application/json');
    expect(h['Accept-Language']).toBe('en-US');
  });

  it('adds Bearer when the provider returns a token, and forwards forceRefresh', async () => {
    await makeReadyStore();
    const provider = jest.fn((force: boolean) => Promise.resolve(force ? 'fresh' : 'tok'));
    setIdTokenProvider(provider);
    expect((await buildHeaders()).Authorization).toBe('Bearer tok');
    expect((await buildHeaders({ forceRefresh: true })).Authorization).toBe('Bearer fresh');
    expect((await buildHeaders({ auth: false })).Authorization).toBeUndefined();
  });

  it('generates a fresh request id per call', async () => {
    await makeReadyStore();
    const a = await buildHeaders();
    const b = await buildHeaders();
    expect(a['X-MM-Request-ID']).toMatch(/^[0-9a-f-]{36}$/);
    expect(a['X-MM-Request-ID']).not.toBe(b['X-MM-Request-ID']);
  });

  it('uses the settings locale for Accept-Language', async () => {
    const { store } = await makeReadyStore();
    store.dispatch(localeSet('ru'));
    expect((await buildHeaders())['Accept-Language']).toBe('ru-RU');
  });

  it('swallows a throwing token provider', async () => {
    await makeReadyStore();
    setIdTokenProvider(() => Promise.reject(new Error('x')));
    expect((await buildHeaders()).Authorization).toBeUndefined();
  });
});
