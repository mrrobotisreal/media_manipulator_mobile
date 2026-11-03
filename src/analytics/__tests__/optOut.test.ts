import { EVENTS } from '../events';
import { makeClient } from '../testing/clientHarness';

describe('analytics opt-out', () => {
  it('no capture while opted out, outbox cleared, capture resumes with the same visitor', async () => {
    let optedOut = false;
    const { client, outbox, fetchMock, sent } = makeClient({}, { optedOut: () => optedOut });
    client.track(EVENTS.SCREEN_VIEWED, { screen: '/tools' });
    expect(outbox.size()).toBe(1);

    optedOut = true;
    client.optOutChanged(true);
    expect(outbox.size()).toBe(0);
    client.track(EVENTS.SCREEN_VIEWED, { screen: '/history' });
    client.track(EVENTS.SIGNUP_COMPLETED, { method: 'email' });
    await client.flush();
    expect(outbox.size()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();

    optedOut = false;
    client.optOutChanged(false);
    client.track(EVENTS.SCREEN_VIEWED, { screen: '/account' });
    await client.flush();
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({
      visitor_id: 'visitor-1',
      properties: { screen: '/account' },
    });
  });

  it('an opt-out during a retrying flush stops sending', async () => {
    let optedOut = false;
    const { client, fetchMock } = makeClient(
      { sleep: async () => void (optedOut = true) },
      { optedOut: () => optedOut },
    );
    fetchMock.mockImplementation(() => Promise.resolve({ status: 503 } as Response));
    client.track(EVENTS.SCREEN_VIEWED, { screen: '/tools' });
    await client.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
