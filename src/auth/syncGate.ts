/**
 * Sync gate (AUTH_AND_IDENTITY §2): follows Firebase auth state and holds the app on
 * `POST /account/sync` before any tool is usable. States: unknown -> signedOut | syncing -> ready | syncFailed.
 */
import type { Dispatch, UnknownAction } from '@reduxjs/toolkit';
import { EVENTS } from '@/analytics/events';
import { identify, track } from '@/analytics/track';
import { isMmError } from '@/api/errors';
import type { SyncRequest, UsageResponse } from '@/api/schemas/account';
import { identityChanged, statusChanged, type AuthIdentity } from '@/state/slices/auth';
import { authErrorCode } from './errors';
import { signupSourceFromProviders, type AuthMethod } from './methods';

/** Retry delays after the first failed attempt (ticket decision 8, proposed): 1 s, 3 s, 9 s. */
export const SYNC_RETRY_DELAYS_MS = [1000, 3000, 9000] as const;

// What the user just did, so a fresh sign-in reports the right `signupSource` (cold start falls back to providerData).
let hint: { method: AuthMethod; displayName?: string } | null = null;

export function hintSignIn(method: AuthMethod, displayName?: string): void {
  hint = { method, displayName };
}

export function clearSignInHint(): void {
  hint = null;
}

export interface SyncGateUser {
  identity: AuthIdentity;
}

export interface SyncGateDeps {
  onAuthChanged: (cb: (user: AuthIdentity | null) => void) => () => void;
  dispatch: Dispatch<UnknownAction>;
  getStatus: () => string;
  sync: (body: SyncRequest) => Promise<UsageResponse>;
  prefetchMe: () => void;
  getLocale: () => string;
  delaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

export interface SyncGate {
  start(): () => void;
  /** Re-runs the sync for the current user (sync-failed Retry). */
  retry(): void;
  /** Re-runs after a profile change (display name set after sign-in). */
  resync(identity: AuthIdentity): void;
}

export function createSyncGate(deps: SyncGateDeps): SyncGate {
  const delays = deps.delaysMs ?? SYNC_RETRY_DELAYS_MS;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let generation = 0;
  let current: AuthIdentity | null = null;

  async function runSync(identity: AuthIdentity): Promise<void> {
    const mine = ++generation;
    deps.dispatch(statusChanged('syncing'));
    const used = hint;
    const body: SyncRequest = {
      displayName: used?.displayName ?? identity.displayName ?? undefined,
      signupSource: used?.method ?? signupSourceFromProviders(identity.providerIds),
      locale: deps.getLocale(),
    };
    for (let attempt = 0; ; attempt++) {
      try {
        const me = await deps.sync(body);
        if (mine !== generation) return;
        hint = null;
        deps.dispatch(statusChanged('ready'));
        identify(identity.uid, { tier: me.tier });
        deps.prefetchMe();
        return;
      } catch (error) {
        if (mine !== generation) return;
        // 401 after MA03's one forced refresh: retrying cannot help.
        const unauthorized = isMmError(error) && error.status === 401;
        const delay = delays[attempt];
        if (unauthorized || delay === undefined) {
          track(EVENTS.AUTH_FAILED, {
            stage: 'sync',
            reason: isMmError(error) ? error.code : authErrorCode(error),
          });
          deps.dispatch(statusChanged('syncFailed'));
          return;
        }
        await sleep(delay);
        if (mine !== generation) return;
      }
    }
  }

  function handle(identity: AuthIdentity | null): void {
    if (!identity) {
      generation++;
      current = null;
      hint = null;
      deps.dispatch(identityChanged(null));
      deps.dispatch(statusChanged('signedOut'));
      return;
    }
    const sameUser = current?.uid === identity.uid;
    current = identity;
    deps.dispatch(identityChanged(identity));
    if (sameUser && deps.getStatus() !== 'syncFailed') return; // token refresh, already synced or in flight
    void runSync(identity);
  }

  return {
    start: () => deps.onAuthChanged(handle),
    retry() {
      if (current) void runSync(current);
    },
    resync(identity) {
      current = identity;
      deps.dispatch(identityChanged(identity));
      void runSync(identity);
    },
  };
}
