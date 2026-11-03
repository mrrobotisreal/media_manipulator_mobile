import { createMMKV } from 'react-native-mmkv';
import { createAnalyticsClient, type ClientDeps } from '../client';
import { createOutbox } from '../outbox';

let store = 0;
let uuid = 0;

export const accepted = (n = 1) =>
  ({ status: 202, json: () => Promise.resolve({ accepted: n }) }) as unknown as Response;

/** A bound client with an in-memory MMKV outbox and a fake fetch; nothing touches the network. */
export function makeClient(
  over: Partial<ClientDeps> = {},
  opts: { optedOut?: () => boolean } = {},
) {
  const fetchMock = jest.fn((_url: string, _init: RequestInit) => Promise.resolve(accepted()));
  const storage = createMMKV({ id: `client-test-${++store}` });
  const outbox = createOutbox(storage);
  const identity = jest.fn(() => ({ visitorId: 'visitor-1', sessionId: 'session-1' }));
  const deps: ClientDeps = {
    outbox,
    transport: {
      baseUrl: 'https://analytics.example.test',
      writeKey: 'mmk_appdev_test',
      userAgent: 'MediaManipulator/1.0.0+1 (Android 14; Pixel)',
      platform: 'android',
      appVersion: '1.0.0+1',
      sdk: { name: 'mm-app', version: '1.0.0' },
      deviceContext: () => ({ device_type: 'mobile' }),
      fetch: fetchMock as unknown as typeof fetch,
      now: Date.now,
    },
    identity,
    optedOut: opts.optedOut ?? (() => false),
    headerTier: () => null,
    uuid: () => `00000000-0000-4000-8000-${(++uuid).toString(16).padStart(12, '0')}`,
    now: Date.now,
    sleep: () => Promise.resolve(),
    random: () => 0,
    timers: globalThis,
    onIdentify: jest.fn(),
    onReset: jest.fn(),
    ...over,
  };
  const client = createAnalyticsClient(true);
  client.bind(deps);
  const sent = () =>
    fetchMock.mock.calls.flatMap(
      (c) => JSON.parse(c[1].body as string).events as Record<string, unknown>[],
    );
  return { client, deps, fetchMock, outbox, storage, identity, sent };
}
