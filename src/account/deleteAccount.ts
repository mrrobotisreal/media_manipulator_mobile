import type { MmError } from '@/api/errors';
import type { AccountDeleteReport } from '@/api/schemas/accountSettings';

export interface DeleteAccountDeps {
  /** Shows the re-auth sheet; resolves true once the user re-authenticated, false when they backed out. */
  reauth(): Promise<boolean>;
  /** `DELETE /account {confirm:"DELETE MY ACCOUNT"}`. */
  call(): Promise<{ ok: true; report: AccountDeleteReport } | { ok: false; error: MmError }>;
  /** After a 200: analytics reset, sign out, MMKV wipe (see `finishAccountDeletion`). */
  finish(): Promise<void>;
}

export type DeleteAccountOutcome =
  | { status: 'done' }
  | { status: 'cancelled' }
  | { status: 'incomplete'; report?: AccountDeleteReport }
  | { status: 'failed'; error: MmError };

/**
 * AUTH_AND_IDENTITY §4. Order: re-authenticate FIRST (so `auth_time` < 5 min), then DELETE; on 401
 * `reauth_required` re-authenticate once more and retry; a 502 is `incomplete` (the call is resumable:
 * calling again continues where it stopped); a 200 runs `finish`.
 */
export async function runAccountDeletion(deps: DeleteAccountDeps): Promise<DeleteAccountOutcome> {
  if (!(await deps.reauth())) return { status: 'cancelled' };
  let res = await deps.call();
  if (!res.ok && res.error.code === 'reauth_required') {
    if (!(await deps.reauth())) return { status: 'cancelled' };
    res = await deps.call();
  }
  if (res.ok) {
    await deps.finish();
    return { status: 'done' };
  }
  if (res.error.status === 502) {
    return {
      status: 'incomplete',
      report: res.error.details.report as AccountDeleteReport | undefined,
    };
  }
  return { status: 'failed', error: res.error };
}

export interface FinishDeps {
  resetAnalytics(): void;
  rotateVisitor(): void;
  trackAccountDeleted(): void;
  /** Best-effort flush of the one `data_deleted` event (bounded wait). */
  flushAnalytics(): Promise<void>;
  /** Stops flush timers and clears the analytics outbox BEFORE the wipe. */
  discardQueued(): void;
  /** Local sign-out without a `signout` event (Firebase user is already gone server-side). */
  signOutLocal(): Promise<void>;
  /** Pauses redux-persist, clears every MMKV instance, then resumes it. */
  wipeStorage(): void;
  /** Resets the in-memory slices that mirror the wiped storage. */
  resetState(): void;
  /** Deletes cached result/intake/original/export files. */
  wipeFiles(): void;
}

/**
 * After a 200. Order (**proposed**, mirrors the web `finishAccountDeletion`): analytics `reset()` and a new
 * anonymous visitor FIRST, so `data_deleted {account, account}` carries no person hint and does not
 * un-erase the old visitor; flush it, then discard the outbox, sign out locally, wipe all MMKV and files.
 */
export async function finishAccountDeletion(d: FinishDeps): Promise<void> {
  d.resetAnalytics();
  d.rotateVisitor();
  d.trackAccountDeleted();
  await d.flushAnalytics().catch(() => undefined);
  d.discardQueued();
  await d.signOutLocal().catch(() => undefined);
  try {
    d.wipeFiles();
  } catch {
    // best effort
  }
  d.wipeStorage();
  d.resetState();
}
