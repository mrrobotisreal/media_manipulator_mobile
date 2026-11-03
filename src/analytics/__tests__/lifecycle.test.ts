import { setIdTokenProvider } from '@/api/authToken';
import { buildHeaders } from '@/api/baseQuery';
import { makeReadyStore } from '@/state/testing';
import { EVENTS } from '../events';
import { createLifecycle, foregroundBucket, WARM_START_MS } from '../lifecycle';
import { ensureFreshSession, resetSessionKeeperForTests, SESSION_IDLE_MS } from '../session';

function harness(ota: string | null = null) {
  let now = 1_000_000;
  const d = {
    track: jest.fn(),
    flush: jest.fn(),
    persistNow: jest.fn(),
    foregrounded: jest.fn(),
    backgrounded: jest.fn(),
    otaUpdateId: () => ota,
    now: () => now,
  };
  const l = createLifecycle(d);
  return { d, l, advance: (ms: number) => (now += ms) };
}

describe('lifecycle', () => {
  it('cold start, then warm only after ≥ 30 s in the background', () => {
    const { d, l, advance } = harness();
    l.coldStart();
    expect(d.track).toHaveBeenLastCalledWith(EVENTS.APP_OPENED, { start: 'cold' });
    l.onAppState('background');
    advance(WARM_START_MS - 1);
    l.onAppState('active');
    expect(d.track.mock.calls.filter((c) => c[1]?.start === 'warm')).toHaveLength(0);
    l.onAppState('background');
    advance(WARM_START_MS);
    l.onAppState('active');
    expect(d.track).toHaveBeenLastCalledWith(EVENTS.APP_OPENED, { start: 'warm' });
    expect(d.foregrounded).toHaveBeenCalledTimes(2);
  });

  it('app_opened carries ota_update_id for an EAS Update', () => {
    const { d, l } = harness('upd-123');
    l.coldStart();
    expect(d.track).toHaveBeenCalledWith(EVENTS.APP_OPENED, {
      start: 'cold',
      ota_update_id: 'upd-123',
    });
  });

  it('app_backgrounded buckets the foreground stretch, persists and flushes', () => {
    const { d, l, advance } = harness();
    l.coldStart();
    advance(90_000);
    l.onAppState('background');
    expect(d.track).toHaveBeenLastCalledWith(EVENTS.APP_BACKGROUNDED, {
      foreground_ms_bucket: '1m_5m',
    });
    expect(d.persistNow).toHaveBeenCalled();
    expect(d.flush).toHaveBeenCalled();
    expect(d.backgrounded).toHaveBeenCalled();
  });

  it('inactive only flushes (iOS shade): no background, no warm start', () => {
    const { d, l, advance } = harness();
    l.coldStart();
    l.onAppState('inactive');
    advance(60_000);
    l.onAppState('active');
    expect(d.flush).toHaveBeenCalledTimes(1);
    expect(d.track).toHaveBeenCalledTimes(1);
    expect(d.foregrounded).not.toHaveBeenCalled();
  });

  it.each([
    [0, 'lt_10s'],
    [9_999, 'lt_10s'],
    [10_000, '10s_1m'],
    [60_000, '1m_5m'],
    [300_000, '5m_30m'],
    [1_800_000, 'gte_30m'],
  ])('bucket %s ms -> %s', (ms, bucket) => {
    expect(foregroundBucket(ms)).toBe(bucket);
  });
});

describe('session rotation', () => {
  beforeEach(() => resetSessionKeeperForTests());
  afterEach(() => setIdTokenProvider(() => Promise.resolve(null)));

  it('≥ 30 min idle rotates the session slice, and the API headers carry the new id', async () => {
    const { store } = await makeReadyStore();
    const t0 = Date.now();
    const first = ensureFreshSession(t0)!;
    expect(first.sessionId).toBe(store.getState().session.sessionId);
    expect(ensureFreshSession(t0 + SESSION_IDLE_MS - 1)!.sessionId).toBe(first.sessionId);

    const later = ensureFreshSession(t0 + 2 * SESSION_IDLE_MS)!;
    expect(later.sessionId).not.toBe(first.sessionId);
    expect(later.visitorId).toBe(first.visitorId);
    expect(store.getState().session.sessionId).toBe(later.sessionId);

    const h = await buildHeaders({ auth: false });
    expect(h['X-MM-Session-ID']).toBe(later.sessionId);
    expect(h['X-MM-Visitor-ID']).toBe(later.visitorId);
  });

  it('activity keeps the session alive', async () => {
    await makeReadyStore();
    const t0 = Date.now();
    const a = ensureFreshSession(t0)!;
    for (let i = 1; i <= 4; i++) ensureFreshSession(t0 + i * (SESSION_IDLE_MS - 1000));
    expect(ensureFreshSession(t0 + 5 * (SESSION_IDLE_MS - 1000))!.sessionId).toBe(a.sessionId);
  });
});
