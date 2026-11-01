/**
 * The only thin wrapper screens/slices may reach Firebase through (plus the sibling modules in
 * src/auth). Everything is lazy: nothing touches the native module unless Firebase is configured.
 */
import {
  getAuth,
  getIdToken,
  onAuthStateChanged,
  reload,
  signOut as firebaseSignOutFn,
  type User,
} from '@react-native-firebase/auth';
import { setIdTokenProvider } from '@/api/authToken';
import type { AuthIdentity } from '@/state/slices/auth';

export type FirebaseUser = User;

export function currentUser(): User | null {
  return getAuth().currentUser;
}

export function onAuthChanged(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(getAuth(), callback);
}

export async function firebaseSignOut(): Promise<void> {
  await firebaseSignOutFn(getAuth());
}

/** Re-reads the user record (used for email verification); returns the refreshed user. */
export async function reloadCurrentUser(): Promise<User | null> {
  const user = currentUser();
  if (!user) return null;
  await reload(user);
  return currentUser();
}

/** Foreground refresh after the user verifies out of band: reload the record and mint a fresh token (new `email_verified` claim). */
export async function refreshIdentity(): Promise<AuthIdentity | null> {
  const user = await reloadCurrentUser();
  if (!user) return null;
  await getIdToken(user, true);
  return toIdentity(user);
}

export function toIdentity(user: User): AuthIdentity {
  return {
    uid: user.uid,
    email: user.email ?? null,
    displayName: user.displayName ?? null,
    providerIds: user.providerData.map((p) => p.providerId),
    emailVerified: user.emailVerified,
  };
}

/** MA03's token seam: `Authorization: Bearer <ID token>` from the current Firebase user. */
export function registerTokenProvider(): void {
  setIdTokenProvider(async (force) => {
    const user = currentUser();
    return user ? getIdToken(user, force) : null;
  });
}
