import { accountSettingsApi } from '@/api/endpoints/accountSettings';
import { performSignOut } from '@/auth/signOut';
import type { AppDispatch } from '@/state/store';

export type SignOutEverywhereResult = 'done' | 'failed';

export interface SignOutEverywhereDeps {
  revoke: () => Promise<unknown>;
  signOut: () => Promise<void>;
}

/**
 * "Sign out everywhere": revoke the Firebase refresh tokens first (needs the current token), then
 * the normal local sign-out. If the revoke fails nothing is signed out, so the user can retry.
 * Other devices keep working until their ID token expires (<= 1 h; account_data.go).
 */
export async function signOutEverywhere(
  deps: SignOutEverywhereDeps,
): Promise<SignOutEverywhereResult> {
  try {
    await deps.revoke();
  } catch {
    return 'failed';
  }
  await deps.signOut().catch(() => undefined);
  return 'done';
}

export function realSignOutEverywhereDeps(dispatch: AppDispatch): SignOutEverywhereDeps {
  return {
    revoke: () => dispatch(accountSettingsApi.endpoints.revokeSessions.initiate()).unwrap(),
    signOut: () => performSignOut(dispatch),
  };
}
