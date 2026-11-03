import { makeReadyStore } from '@/state/testing';
import { record } from '@/jobs/testFixtures';
import { jobUpserted } from '@/state/slices/jobs';
import { observed } from '@/state/slices/quota';
import { performSignOut } from '../signOut';

const calls: string[] = [];
jest.mock('@/analytics/track', () => ({
  track: (n: string) => calls.push(`track:${n}`),
  identify: jest.fn(),
  reset: () => calls.push('analytics.reset'),
}));

describe('signOut', () => {
  it('orders the calls and resets local state, keeping visitorId and rotating sessionId', async () => {
    calls.length = 0;
    const { store } = await makeReadyStore();
    store.dispatch(jobUpserted(record({ localId: 'j' })));
    store.dispatch(observed({ tier: 'pro', metric: 'ops', limit: 5, remaining: 2 }));
    const before = store.getState().session;

    await performSignOut(store.dispatch, {
      firebaseSignOut: async () => void calls.push('firebase'),
      googleSignOut: async () => void calls.push('google'),
    });

    expect(calls).toEqual(['track:signout', 'analytics.reset', 'firebase', 'google']);
    const after = store.getState();
    expect(after.session.visitorId).toBe(before.visitorId);
    expect(after.session.sessionId).not.toBe(before.sessionId);
    expect(after.jobs.order).toEqual([]);
    expect(after.quota.tier).toBeNull();
    expect(Object.keys(after.mmApi.queries)).toEqual([]);
  });

  it('still clears local state when Firebase sign-out throws', async () => {
    const { store } = await makeReadyStore();
    store.dispatch(observed({ tier: 'pro' }));
    await expect(
      performSignOut(store.dispatch, {
        firebaseSignOut: async () => {
          throw new Error('x');
        },
        googleSignOut: async () => {},
      }),
    ).rejects.toThrow();
    expect(store.getState().quota.tier).toBeNull();
  });

  it('sign-out deletes the server token before Firebase sign-out and never blocks', async () => {
    calls.length = 0;
    const { store } = await makeReadyStore();
    await performSignOut(store.dispatch, {
      releasePush: async (_d, o) => void calls.push(`push:${o.server}`),
      firebaseSignOut: async () => void calls.push('firebase'),
      googleSignOut: async () => void calls.push('google'),
    });
    expect(calls).toEqual(['track:signout', 'analytics.reset', 'push:true', 'firebase', 'google']);

    calls.length = 0;
    await performSignOut(store.dispatch, {
      releasePush: async () => {
        throw new Error('offline');
      },
      firebaseSignOut: async () => void calls.push('firebase'),
      googleSignOut: async () => void calls.push('google'),
    });
    expect(calls).toContain('firebase');
  });

  it('a silent sign-out (account deletion) and an expired session skip the server DELETE', async () => {
    const { store } = await makeReadyStore();
    const release = jest.fn(async () => undefined);
    const d = {
      releasePush: release,
      firebaseSignOut: async () => {},
      googleSignOut: async () => {},
    };
    await performSignOut(store.dispatch, d, { silent: true });
    expect(release).not.toHaveBeenCalled();
    await performSignOut(store.dispatch, d, { pushServer: false });
    expect(release).toHaveBeenCalledWith(expect.anything(), { server: false });
  });
});
