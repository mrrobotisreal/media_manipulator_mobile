import {
  EmailAuthProvider,
  getIdToken,
  reauthenticateWithCredential,
  type AuthCredential,
} from '@react-native-firebase/auth';
import { getAppleNativeCredential, isAppleNative, reauthenticateAppleAndroid } from './apple';
import { currentUser } from './firebase';
import { getGoogleCredential } from './google';
import { methodFromProviderId, type AuthMethod } from './methods';

export type ReauthMethod =
  { kind: 'google' } | { kind: 'apple' } | { kind: 'password'; password: string };

/** Thrown when the user backs out of the Google/Apple sheet. */
export class ReauthCancelled extends Error {
  constructor() {
    super('reauth cancelled');
    this.name = 'ReauthCancelled';
  }
}

/** Methods the signed-in user can re-authenticate with, from `providerData`. */
export function availableReauthMethods(): AuthMethod[] {
  const user = currentUser();
  if (!user) return [];
  const out: AuthMethod[] = [];
  for (const p of user.providerData) {
    const m = methodFromProviderId(p.providerId);
    if (m !== 'other' && !out.includes(m)) out.push(m);
  }
  return out;
}

/**
 * Fresh authentication so the next ID token has `auth_time` < 5 min (account deletion,
 * `reauth_required`). Returns `getIdToken(true)`.
 */
export async function reauthenticate(method: ReauthMethod): Promise<string> {
  const user = currentUser();
  if (!user) throw new Error('Not signed in');
  if (method.kind === 'apple' && !isAppleNative()) {
    await reauthenticateAppleAndroid(user);
  } else {
    let credential: AuthCredential | null;
    if (method.kind === 'google') {
      credential = await getGoogleCredential();
    } else if (method.kind === 'apple') {
      credential = (await getAppleNativeCredential())?.credential ?? null;
    } else {
      if (!user.email) throw new Error('This account has no email to re-authenticate with');
      credential = EmailAuthProvider.credential(user.email, method.password);
    }
    if (!credential) throw new ReauthCancelled();
    await reauthenticateWithCredential(user, credential);
  }
  return getIdToken(user, true);
}
