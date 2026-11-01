/**
 * Firebase / provider error to UI string key (`authStrings.errors.*`) and analytics reason.
 * wrong-password, user-not-found and invalid-credential share one key on purpose (no enumeration).
 */
export type AuthErrorKey =
  | 'invalidCredential'
  | 'emailInUse'
  | 'weakPassword'
  | 'invalidEmail'
  | 'tooManyRequests'
  | 'network'
  | 'generic';

const KEY_BY_CODE: Record<string, AuthErrorKey> = {
  'auth/invalid-credential': 'invalidCredential',
  'auth/wrong-password': 'invalidCredential',
  'auth/user-not-found': 'invalidCredential',
  'auth/email-already-in-use': 'emailInUse',
  'auth/weak-password': 'weakPassword',
  'auth/invalid-email': 'invalidEmail',
  'auth/too-many-requests': 'tooManyRequests',
  'auth/network-request-failed': 'network',
};

/** The Firebase (or provider) error code, or `unknown`. Never a message. */
export function authErrorCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.length > 0) return code;
  }
  return 'unknown';
}

export function authErrorKey(error: unknown): AuthErrorKey {
  return KEY_BY_CODE[authErrorCode(error)] ?? 'generic';
}

export function isAccountExistsError(error: unknown): boolean {
  const code = authErrorCode(error);
  return (
    code === 'auth/account-exists-with-different-credential' ||
    code === 'auth/credential-already-in-use'
  );
}

/** Email attached to an account-exists error, if Firebase gave one. */
export function errorEmail(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const e = error as { email?: unknown; customData?: { email?: unknown } };
  const value = e.customData?.email ?? e.email;
  return typeof value === 'string' ? value : undefined;
}
