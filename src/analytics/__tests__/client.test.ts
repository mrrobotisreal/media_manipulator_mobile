import { resetContextForTests, setContext } from '../context';
import { createAnalyticsClient } from '../client';
import { EVENTS } from '../events';
import { makeClient } from '../testing/clientHarness';

describe('analytics client', () => {
  beforeEach(() => resetContextForTests());

  it('builds the wire event shape', async () => {
    const { client, sent } = makeClient();
    setContext({ tool_slug: 'image-convert' });
    client.track(EVENTS.TOOL_VIEWED, { entry_point: 'tools_tab' });
    await client.flush();
    const [e] = sent();
    expect(e).toMatchObject({
      event_name: 'tool_viewed',
      visitor_id: 'visitor-1',
      session_id: 'session-1',
      properties: { entry_point: 'tools_tab' },
      context: { tool_slug: 'image-convert', locale: 'en-US', connection_type: 'unknown' },
    });
    expect(e!.insert_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(e!.event_ts as string).toISOString()).toBe(e!.event_ts);
    expect(e!.person_hint).toBeUndefined();
    expect(e!.priority).toBeUndefined();
  });

  it('person_hint after identify, cleared after reset; tier refresh', async () => {
    const { client, sent, deps } = makeClient();
    client.identify('uid-1', { tier: 'pro' });
    expect(deps.onIdentify).toHaveBeenCalledWith('uid-1', 'pro');
    client.track(EVENTS.SIGNOUT);
    client.tierChanged('premium');
    client.track(EVENTS.SIGNOUT);
    client.reset();
    expect(deps.onReset).toHaveBeenCalled();
    client.track(EVENTS.SIGNOUT);
    await client.flush();
    const events = sent();
    expect(events.map((e) => e.person_hint)).toEqual([
      { firebase_uid: 'uid-1', tier: 'pro' },
      { firebase_uid: 'uid-1', tier: 'premium' },
      undefined,
    ]);
    expect(events[2]!.context).not.toHaveProperty('tier');
  });

  it('rejects forbidden property keys', async () => {
    const { client, outbox } = makeClient();
    for (const key of ['name', 'filename', 'path', 'email']) {
      client.track(EVENTS.FEATURE_USED, { feature: 'x', action: 'y', [key]: 'leak' } as never);
    }
    expect(outbox.size()).toBe(0);
  });

  it('flush policy: p0 now, p1 after 2 s, others at 15 s or 20 events', async () => {
    jest.useFakeTimers();
    const { client, fetchMock } = makeClient();
    client.track(EVENTS.SIGNUP_COMPLETED, { method: 'email' });
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    client.track(EVENTS.SIGNIN_COMPLETED, { method: 'email' });
    await jest.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    client.track(EVENTS.SCREEN_VIEWED, { screen: '/tools' });
    await jest.advanceTimersByTimeAsync(14_999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    for (let i = 0; i < 20; i++) client.track(EVENTS.SCREEN_VIEWED, { screen: `/s${i}` });
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    jest.useRealTimers();
  });

  it('one flush in flight at a time; a trigger during it runs once more', async () => {
    let release: (() => void) | null = null;
    const { client, fetchMock } = makeClient();
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((r) => (release = () => r({ status: 202, json: async () => ({}) } as never))),
    );
    client.track(EVENTS.SIGNUP_COMPLETED, { method: 'email' });
    client.track(EVENTS.JOB_STARTED, { job_id: 'j' });
    client.track(EVENTS.JOB_COMPLETED, { job_id: 'j' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release!();
    await client.flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries with backoff up to 5 attempts, then keeps the events', async () => {
    const sleep = jest.fn(() => Promise.resolve());
    const { client, fetchMock, outbox } = makeClient({ sleep, random: () => 1 });
    fetchMock.mockImplementation(() => Promise.resolve({ status: 503 } as Response));
    client.track(EVENTS.SCREEN_VIEWED, { screen: '/tools' });
    await client.flush();
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([2000, 4000, 8000, 16000]);
    expect(outbox.size()).toBe(1);
  });

  it('a 401 drops the batch and emits no client_error', async () => {
    const { client, fetchMock, outbox } = makeClient();
    fetchMock.mockImplementation(() => Promise.resolve({ status: 401 } as Response));
    client.track(EVENTS.SCREEN_VIEWED, { screen: '/tools' });
    await client.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(outbox.size()).toBe(0);
  });

  it('buffers before bind, then stamps the bound identity', async () => {
    const pre = createAnalyticsClient(true);
    pre.track(EVENTS.APP_OPENED, { start: 'cold' });
    const { deps, sent } = makeClient();
    pre.bind(deps);
    await pre.flush();
    expect(sent()[0]).toMatchObject({ event_name: 'app_opened', visitor_id: 'visitor-1' });
  });

  it('disabled without a write key: no capture, no outbox growth', () => {
    const off = createAnalyticsClient(false);
    const { deps } = makeClient();
    off.bind(deps);
    off.track(EVENTS.SCREEN_VIEWED, { screen: '/tools' });
    expect(deps.outbox.size()).toBe(0);
    expect(off.isEnabled()).toBe(false);
  });
});
