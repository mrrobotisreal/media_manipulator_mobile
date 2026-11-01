/**
 * Account linking (AUTH_AND_IDENTITY §1). Firebase allows one account per email, so signing in with
 * a second provider fails with `auth/account-exists-with-different-credential`. We keep the pending
 * credential in memory (never in Redux or storage), ask the user to sign in with their other method,
 * then `linkWithCredential`. The Android Apple web flow yields no credential: after the user signs
 * in with the other method we offer "Link Apple" instead. Linking never blocks sign-in.
 */
import type { Dispatch, UnknownAction } from '@reduxjs/toolkit';
import {
  fetchSignInMethodsForEmail,
  getAuth,
  linkWithCredential,
  type AuthCredential,
  type User,
} from '@react-native-firebase/auth';
import { appleLinkOfferSet, linkPromptSet, noticeSet } from '@/state/slices/auth';
import { trackAuthFailed } from './analytics';
import { linkAppleAndroid } from './apple';
import { methodFromProviderId, type AuthMethod } from './methods';

interface Pending {
  credential: AuthCredential | null;
  method: 'google' | 'apple';
  email?: string;
}

let pending: Pending | null = null;

export function setPendingLink(next: Pending): void {
  pending = next;
}

export function hasPendingLink(): boolean {
  return pending !== null;
}

export function clearPendingLink(): void {
  pending = null;
}

/** Providers to offer on the linking sheet: what Firebase says exists for the email, else all (enumeration protection returns []). */
export async function linkProviderOptions(
  email: string | undefined,
  attempted: AuthMethod,
  lookup: (email: string) => Promise<string[]> = (e) => fetchSignInMethodsForEmail(getAuth(), e),
): Promise<AuthMethod[]> {
  const all: AuthMethod[] = ['apple', 'google', 'email'];
  let found: AuthMethod[] = [];
  if (email) {
    try {
      found = (await lookup(email))
        .map(methodFromProviderId)
        .filter((m): m is AuthMethod => m !== 'other');
    } catch {
      found = [];
    }
  }
  const options = found.length > 0 ? found : all;
  return options.filter((m) => m !== attempted);
}

/**
 * Called after any successful sign-in. Links the kept credential (success notice) or, for the
 * credential-less Android Apple case, raises the "Link Apple" offer. Failures are reported, never thrown.
 */
export async function completePendingLink(
  user: User,
  dispatch: Dispatch<UnknownAction>,
): Promise<void> {
  const p = pending;
  if (!p) return;
  pending = null;
  dispatch(linkPromptSet(null));
  if (!p.credential) {
    dispatch(appleLinkOfferSet(true));
    return;
  }
  try {
    await linkWithCredential(user, p.credential);
    dispatch(noticeSet('linked'));
  } catch (error) {
    trackAuthFailed(p.method, 'link', error);
  }
}

/** The "Link Apple" action behind the offer banner (Android). */
export async function linkAppleNow(
  user: User,
  dispatch: Dispatch<UnknownAction>,
): Promise<boolean> {
  try {
    await linkAppleAndroid(user);
    dispatch(appleLinkOfferSet(false));
    dispatch(noticeSet('linked'));
    return true;
  } catch (error) {
    trackAuthFailed('apple', 'link', error);
    return false;
  }
}
