import { makeReadyStore } from '../testing';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('session slice', () => {
  it('visitorId is a UUIDv4 and stable across store rebuilds', async () => {
    const first = await makeReadyStore();
    await first.persistor.flush();
    const id = first.store.getState().session.visitorId;
    expect(id).toMatch(UUID_V4);
    const second = await makeReadyStore();
    expect(second.store.getState().session.visitorId).toBe(id);
  });
});
