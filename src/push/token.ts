import type { PermissionState } from './permission';

export interface RegisterBody {
  token: string;
  platform: 'ios' | 'android';
  appVersion: string;
  locale: string;
}

export type RegisterOutcome = 'ok' | 'not_synced' | 'failed';
export type SyncOutcome = 'registered' | 'skipped' | 'retry' | 'failed';

export interface TokenDeps {
  permission(): Promise<PermissionState>;
  getToken(): Promise<string | null>;
  deleteToken(): Promise<void>;
  register(body: RegisterBody): Promise<RegisterOutcome>;
  unregister(token: string): Promise<void>;
  platform(): 'ios' | 'android' | null;
  appVersion(): string;
  locale(): string;
  /** Upper bound for the server DELETE at sign-out. */
  signOutTimeoutMs?: number;
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | undefined> =>
  Promise.race([p, new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))]);

/**
 * Token lifecycle (decision 5). The token lives in this closure only: never in redux, MMKV, analytics,
 * Crashlytics or a log line.
 */
export function createTokenManager(deps: TokenDeps) {
  let token: string | null = null;

  async function post(t: string): Promise<SyncOutcome> {
    const platform = deps.platform();
    if (!platform) return 'skipped';
    const r = await deps.register({
      token: t,
      platform,
      appVersion: deps.appVersion(),
      locale: deps.locale(),
    });
    return r === 'ok' ? 'registered' : r === 'not_synced' ? 'retry' : 'failed';
  }

  /** After sync is `ready`, on every cold start, after a locale change and after a grant. */
  async function sync(): Promise<SyncOutcome> {
    try {
      if ((await deps.permission()) !== 'granted') return 'skipped';
      const t = await deps.getToken();
      if (!t) return 'skipped';
      token = t;
      return await post(t);
    } catch {
      return 'failed';
    }
  }

  /** FCM rotated the token: register the new one (the old row is disabled by the server on its first failed send). */
  async function onRefresh(t: string): Promise<SyncOutcome> {
    token = t;
    try {
      if ((await deps.permission()) !== 'granted') return 'skipped';
      return await post(t);
    } catch {
      return 'failed';
    }
  }

  /**
   * Sign-out / sign out everywhere: `DELETE` while the Bearer is still valid, then `deleteToken()`.
   * `server:false` (session expired, account deleted) skips the DELETE. Failures never block sign-out.
   */
  async function release(opts: { server: boolean }): Promise<void> {
    try {
      if (opts.server) {
        const t = token ?? (await deps.getToken());
        if (t) await withTimeout(deps.unregister(t), deps.signOutTimeoutMs ?? 4000);
      }
    } catch {
      // never blocks sign-out
    }
    try {
      await deps.deleteToken();
    } catch {
      // best effort
    }
    token = null;
  }

  return { sync, onRefresh, release, hasToken: () => token !== null };
}

export type TokenManager = ReturnType<typeof createTokenManager>;
