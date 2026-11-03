import { createMMKV } from 'react-native-mmkv';
import { createAnalyticsClient } from '@/analytics/client';
import { makeClient } from '@/analytics/testing/clientHarness';
import { EVENTS } from '@/analytics/events';
import { wipeAllStorage } from '@/state/persist';
import { settingsReset, analyticsOptOutSet, localeSet } from '@/state/slices/settings';
import { visitorRotated } from '@/state/slices/session';
import { makeReadyStore } from '@/state/testing';

describe('account deletion local wipe', () => {
  it('account deletion wipes MMKV and rotates visitorId', async () => {
    const { store, persistor } = await makeReadyStore();
    store.dispatch(localeSet('de-DE'));
    store.dispatch(analyticsOptOutSet(true));
    await persistor.flush();
    createMMKV({ id: 'mm-analytics' }).set('outbox.v1', '[{"insert_id":"a"}]');
    const app = createMMKV({ id: 'mm-app' });
    expect(app.getAllKeys().length).toBeGreaterThan(0);
    const before = store.getState().session;

    persistor.pause();
    wipeAllStorage();
    store.dispatch(settingsReset());
    store.dispatch(visitorRotated());

    expect(app.getAllKeys()).toEqual([]);
    expect(createMMKV({ id: 'mm-analytics' }).getAllKeys()).toEqual([]);
    const s = store.getState();
    expect(s.settings.locale).toBeNull();
    expect(s.settings.analyticsOptOut).toBe(false);
    expect(s.session.visitorId).not.toBe(before.visitorId);
    expect(s.session.sessionId).not.toBe(before.sessionId);
  });
});

describe('analytics client discardQueued', () => {
  it('drops the outbox and a flush afterwards sends nothing from the old person', async () => {
    const { client, outbox, fetchMock } = makeClient();
    client.track(EVENTS.SCREEN_VIEWED, { screen: '/account' });
    client.track(EVENTS.SCREEN_VIEWED, { screen: '/history' });
    expect(outbox.size()).toBe(2);
    client.discardQueued();
    expect(outbox.size()).toBe(0);
    await client.flush();
    expect(fetchMock).not.toHaveBeenCalled();
    // capture stays enabled for the new anonymous identity
    client.track(EVENTS.SCREEN_VIEWED, { screen: '/' });
    expect(outbox.size()).toBe(1);
  });

  it('stops the flush timers and aborts a drain in progress', async () => {
    const { client, outbox, fetchMock, deps } = makeClient();
    const clear = jest.spyOn(deps.timers, 'clearTimeout');
    client.track(EVENTS.SCREEN_VIEWED, { screen: '/a' }); // arms the 15 s interval timer
    client.discardQueued();
    expect(clear).toHaveBeenCalled();
    clear.mockRestore();

    // A drain is waiting on the network when the discard happens: it must not remove or resend after.
    let resolveFetch: (r: Response) => void = () => {};
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((r) => {
          resolveFetch = r;
        }),
    );
    client.track(EVENTS.SCREEN_VIEWED, { screen: '/b' });
    const flushing = client.flush();
    client.discardQueued();
    resolveFetch({ status: 503 } as Response);
    await flushing;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(outbox.size()).toBe(0);
  });

  it('is safe before bind and on a disabled client', () => {
    const c = createAnalyticsClient(false);
    expect(() => c.discardQueued()).not.toThrow();
  });
});
