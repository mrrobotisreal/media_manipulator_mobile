/**
 * Sign in with Apple.
 * iOS: native (`@invertase/react-native-apple-authentication`) with a raw nonce whose SHA-256 goes to Apple.
 * Android (decision, MA04): Firebase's web-based OAuth through RNFirebase's `signInWithPopup(auth,
 * new OAuthProvider('apple.com'))`, which the library maps to the native SDK's `signInWithProvider`
 * (Custom Tab on https://<authDomain>/__/auth/handler). The library-only fallback
 * (`appleAuthAndroid`) is not needed, so EXPO_PUBLIC_APPLE_SERVICE_ID / _REDIRECT_URI stay unused.
 */
import {
  OAuthProvider,
  getAuth,
  getAdditionalUserInfo,
  linkWithPopup,
  reauthenticateWithPopup,
  signInWithPopup,
  type AuthCredential,
  type AuthProvider,
  type User,
  type UserCredential,
} from '@react-native-firebase/auth';
import { appleAuth } from '@invertase/react-native-apple-authentication';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

export interface AppleNativeResult {
  credential: AuthCredential;
  /** Full name, which Apple returns only on the very first authorization. */
  displayName?: string;
}

export function isAppleNative(): boolean {
  return Platform.OS === 'ios';
}

function newRawNonce(): string {
  return Array.from(Crypto.getRandomBytes(32), (b) => b.toString(16).padStart(2, '0')).join('');
}

function joinName(
  name: { givenName?: string | null; familyName?: string | null } | null,
): string | undefined {
  const full = [name?.givenName, name?.familyName].filter(Boolean).join(' ').trim();
  return full.length > 0 ? full.slice(0, 80) : undefined;
}

function cancelled(error: unknown): boolean {
  return (error as { code?: unknown }).code === appleAuth.Error.CANCELED;
}

/** iOS: Apple sheet to Firebase credential. `null` when the user cancelled. */
export async function getAppleNativeCredential(): Promise<AppleNativeResult | null> {
  const rawNonce = newRawNonce();
  try {
    // The library SHA-256-hashes `nonce` before sending it to Apple and returns the raw value.
    const response = await appleAuth.performRequest({
      requestedOperation: appleAuth.Operation.LOGIN,
      requestedScopes: [appleAuth.Scope.EMAIL, appleAuth.Scope.FULL_NAME],
      nonce: rawNonce,
    });
    if (!response.identityToken) {
      throw Object.assign(new Error('no identity token'), { code: 'apple/no-identity-token' });
    }
    const provider = new OAuthProvider('apple.com');
    const credential = provider.credential({
      idToken: response.identityToken,
      rawNonce: response.nonce ?? rawNonce,
    });
    return { credential, displayName: joinName(response.fullName) };
  } catch (error) {
    if (cancelled(error)) return null;
    throw error;
  }
}

/** RNFirebase's `OAuthProvider` implements `AuthProvider` structurally but declares `providerId` private. */
function androidProvider(): AuthProvider {
  return new OAuthProvider('apple.com')
    .addScope('email')
    .addScope('name') as unknown as AuthProvider;
}

/** Name from the Apple web flow profile (first sign-in only), when Firebase did not set one. */
function profileName(result: UserCredential): string | undefined {
  const profile = getAdditionalUserInfo(result)?.profile as
    { name?: { firstName?: string; lastName?: string } | string } | undefined;
  const name = profile?.name;
  if (typeof name === 'string') return name.trim().slice(0, 80) || undefined;
  return joinName(name ? { givenName: name.firstName, familyName: name.lastName } : null);
}

/** Android: Custom Tab flow. Signs in directly (there is no credential to keep for linking). */
export async function signInWithAppleAndroid(): Promise<{
  result: UserCredential;
  displayName?: string;
}> {
  const result = await signInWithPopup(getAuth(), androidProvider());
  return { result, displayName: result.user.displayName ? undefined : profileName(result) };
}

/** Android: link Apple to the signed-in user. */
export function linkAppleAndroid(user: User): Promise<UserCredential> {
  return linkWithPopup(user, androidProvider());
}

/** Android: fresh Apple authentication for the signed-in user. */
export function reauthenticateAppleAndroid(user: User): Promise<UserCredential> {
  return reauthenticateWithPopup(user, androidProvider());
}
