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
});
