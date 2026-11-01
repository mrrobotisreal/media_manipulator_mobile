import { mmkvStorage } from '../persist';
import { makeReadyStore } from '../testing';
import { hapticsSet } from '../slices/settings';

const flush = (p: { flush: () => Promise<unknown> }) => p.flush();

describe('persist', () => {
  it('adapter round-trips', async () => {
    await mmkvStorage.setItem('k', 'v');
    expect(await mmkvStorage.getItem('k')).toBe('v');
    await mmkvStorage.removeItem('k');
    expect(await mmkvStorage.getItem('k')).toBeUndefined();
  });

  it('persists session, settings, jobs and not auth, quota', async () => {
    const { store, persistor } = await makeReadyStore();
    store.dispatch(hapticsSet(false));
    await flush(persistor);
    expect(await mmkvStorage.getItem('persist:settings')).toContain('"haptics":"false"');
    expect(await mmkvStorage.getItem('persist:session')).toBeTruthy();
    expect(await mmkvStorage.getItem('persist:jobs')).toBeTruthy();
    expect(await mmkvStorage.getItem('persist:auth')).toBeUndefined();
    expect(await mmkvStorage.getItem('persist:quota')).toBeUndefined();
  });
});
