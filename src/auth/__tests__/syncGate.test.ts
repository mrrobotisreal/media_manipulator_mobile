import type { AuthIdentity } from '@/state/slices/auth';
import { track } from '@/analytics/track';
import type { MmError } from '@/api/errors';
import { clearSignInHint, createSyncGate, hintSignIn, SYNC_RETRY_DELAYS_MS } from '../syncGate';

jest.mock('@/analytics/track', () => ({ track: jest.fn(), identify: jest.fn(), reset: jest.fn() }));

const me = { tier: 'free' } as never;
const id = (over: Partial<AuthIdentity> = {}): AuthIdentity => ({
  uid: 'u1',
  email: 'a@b.co',
  displayName: 'Ada',
  providerIds: ['google.com'],
  emailVerified: true,
  ...over,
});

function setup(sync: jest.Mock) {
  let emit!: (u: AuthIdentity | null) => void;
  const statuses: string[] = [];
  const sleeps: number[] = [];
  const gate = createSyncGate({
    onAuthChanged: (cb) => {
      emit = cb;
      return () => {};
    },
    dispatch: ((a: { type: string; payload?: unknown }) => {
      if (a.type === 'auth/statusChanged') statuses.push(a.payload as string);
    }) as never,
    getStatus: () => statuses[statuses.length - 1] ?? 'unknown',
    sync,
    prefetchMe: jest.fn(),
    getLocale: () => 'de-DE',
    sleep: async (ms) => void sleeps.push(ms),
  });
  gate.start();
  return { emit: (u: AuthIdentity | null) => emit(u), statuses, sleeps, gate };
}
const flush = () => new Promise((r) => setImmediate(r));

describe('syncGate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearSignInHint();
  });

  it('signedOut, then syncing -> ready with the exact body; cold start source from providerData', async () => {
    const sync = jest.fn().mockResolvedValue(me);
    const { emit, statuses } = setup(sync);
    emit(null);
    emit(id({ providerIds: ['password'] }));
    await flush();
    expect(statuses).toEqual(['signedOut', 'syncing', 'ready']);
    expect(sync).toHaveBeenCalledWith({
      displayName: 'Ada',
      signupSource: 'email',
      locale: 'de-DE',
    });
  });

  it('a fresh sign-in reports the method just used and its name', async () => {
    const sync = jest.fn().mockResolvedValue(me);
    const { emit } = setup(sync);
    hintSignIn('apple', 'Ada Apple');
    emit(id({ providerIds: ['apple.com'], displayName: null }));
    await flush();
    expect(sync).toHaveBeenCalledWith({
      displayName: 'Ada Apple',
      signupSource: 'apple',
      locale: 'de-DE',
    });
  });

  it('unknown provider maps to other', async () => {
    const sync = jest.fn().mockResolvedValue(me);
    const { emit } = setup(sync);
    emit(id({ providerIds: ['github.com'] }));
    await flush();
    expect(sync.mock.calls[0][0].signupSource).toBe('other');
  });

  it('retries at 1s, 3s, 9s then syncFailed; Retry re-runs', async () => {
    const sync = jest.fn().mockRejectedValue(new Error('x'));
    const { emit, statuses, sleeps, gate } = setup(sync);
    emit(id());
    await flush();
    expect(sleeps).toEqual([...SYNC_RETRY_DELAYS_MS]);
    expect(sync).toHaveBeenCalledTimes(4);
    expect(statuses[statuses.length - 1]).toBe('syncFailed');
    expect(track).toHaveBeenCalledWith('auth_failed', expect.objectContaining({ stage: 'sync' }));

    sync.mockResolvedValue(me);
    gate.retry();
    await flush();
    expect(statuses[statuses.length - 1]).toBe('ready');
  });

  it('a 401 goes straight to syncFailed without retrying', async () => {
    const err: MmError = { status: 401, code: 'unauthenticated', details: {} };
    const sync = jest.fn().mockRejectedValue(err);
    const { emit, statuses, sleeps } = setup(sync);
    emit(id());
    await flush();
    expect(sleeps).toEqual([]);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(statuses[statuses.length - 1]).toBe('syncFailed');
  });

  it('a token refresh for the same ready user does not re-sync', async () => {
    const sync = jest.fn().mockResolvedValue(me);
    const { emit } = setup(sync);
    emit(id());
    await flush();
    emit(id());
    await flush();
    expect(sync).toHaveBeenCalledTimes(1);
  });
});
