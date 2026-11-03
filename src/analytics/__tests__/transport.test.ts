import { appVersionString, resetUserAgentCache, userAgent } from '@/lib/userAgent';
import type { WireEvent } from '../outbox';
import {
  backoffDelay,
  BATCH_MAX_BYTES,
  buildEnvelope,
  sendBatch,
  splitBatches,
  type TransportConfig,
} from '../transport';

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.0.0',
  nativeBuildVersion: '7',
}));
jest.mock('expo-device', () => ({ osVersion: '14', modelName: 'Pixel 8' }));

const ev = (i: number, over: Partial<WireEvent> = {}): WireEvent => ({
  insert_id: `id-${i}`,
  event_name: 'screen_viewed',
  event_ts: '2026-11-03T12:00:00.000Z',
  visitor_id: 'v',
  session_id: 's',
  context: {},
  properties: { screen: '/tools' },
  priority: 2,
  ...over,
});

const response = (status: number, body?: unknown) =>
  ({ status, json: () => Promise.resolve(body) }) as unknown as Response;

function cfg(fetchImpl: jest.Mock): TransportConfig {
  resetUserAgentCache();
  return {
    baseUrl: 'https://analytics.example.test',
    writeKey: 'mmk_appdev_test',
    userAgent: userAgent(),
    platform: 'android',
    appVersion: appVersionString(),
    sdk: { name: 'mm-app', version: '1.0.0' },
    deviceContext: () => ({ device_type: 'mobile', os: 'Android 14' }),
    fetch: fetchImpl as unknown as typeof fetch,
    now: () => Date.parse('2026-11-03T12:00:05Z'),
    log: jest.fn(),
  };
}

describe('transport', () => {
  it('envelope: sdk mm-app, platform, app_version x.y.z+n; header key + UA without okhttp; no local priority', async () => {
    const f = jest.fn(() => Promise.resolve(response(202, { accepted: 1 })));
    const c = cfg(f);
    await sendBatch(c, [ev(1)]);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://analytics.example.test/v1/capture');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-MM-Write-Key']).toBe('mmk_appdev_test');
    expect(headers['User-Agent']).toMatch(
      /^MediaManipulator\/1\.0\.0\+7 \((Android|iOS) 14; Pixel 8\)$/,
    );
    expect(headers['User-Agent']).not.toMatch(/okhttp/i);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      write_key: 'mmk_appdev_test',
      sent_at: '2026-11-03T12:00:05.000Z',
      sdk: { name: 'mm-app', version: '1.0.0' },
      platform: 'android',
      context: { device_type: 'mobile', os: 'Android 14' },
    });
    expect(body.app_version).toMatch(/^\d+\.\d+\.\d+\+\d+$/);
    expect(body.events[0].priority).toBeUndefined();
    expect(buildEnvelope(c, [ev(1)]).events).toHaveLength(1);
  });

  it('202 with partial rejects is done (rejected reasons logged)', async () => {
    const c = cfg(
      jest.fn(() =>
        Promise.resolve(response(202, { accepted: 1, rejected: [{ index: 1, reason: 'bad' }] })),
      ),
    );
    expect(await sendBatch(c, [ev(1), ev(2)])).toEqual({ kind: 'done', accepted: 1, rejected: 1 });
    expect(c.log).toHaveBeenCalledWith('capture rejected events', [{ index: 1, reason: 'bad' }]);
  });

  it.each([400, 401, 413])('%s drops the batch', async (status) => {
    const c = cfg(jest.fn(() => Promise.resolve(response(status))));
    expect(await sendBatch(c, [ev(1)])).toEqual({ kind: 'drop', status });
  });

  it.each([429, 500, 503])('%s retries', async (status) => {
    const c = cfg(jest.fn(() => Promise.resolve(response(status))));
    expect(await sendBatch(c, [ev(1)])).toEqual({ kind: 'retry', status });
  });

  it('a network error retries', async () => {
    const c = cfg(jest.fn(() => Promise.reject(new TypeError('Network request failed'))));
    expect(await sendBatch(c, [ev(1)])).toEqual({ kind: 'retry', status: 'network' });
  });

  it('backoff: exponential with full jitter between 1 s and 60 s', () => {
    expect(backoffDelay(0, () => 0)).toBe(1000);
    expect(backoffDelay(0, () => 1)).toBe(2000);
    expect(backoffDelay(1, () => 1)).toBe(4000);
    expect(backoffDelay(3, () => 1)).toBe(16000);
    expect(backoffDelay(10, () => 1)).toBe(60000);
    expect(backoffDelay(10, () => 0.5)).toBe(30500);
  });

  it('splits at 100 events and at 60 KB', () => {
    expect(splitBatches(Array.from({ length: 250 }, (_, i) => ev(i))).map((b) => b.length)).toEqual(
      [100, 100, 50],
    );
    const big = Array.from({ length: 10 }, (_, i) =>
      ev(i, { properties: { screen: 'x'.repeat(15_000) } }),
    );
    const batches = splitBatches(big);
    expect(batches.map((b) => b.length)).toEqual([3, 3, 3, 1]);
    for (const b of batches) expect(JSON.stringify(b).length).toBeLessThan(BATCH_MAX_BYTES + 1000);
  });
});
