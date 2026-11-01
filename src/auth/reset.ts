import { getAuth, sendPasswordResetEmail } from '@react-native-firebase/auth';
import { trackAuthFailed, trackPasswordResetRequested } from './analytics';
import { authErrorCode, authErrorKey, type AuthErrorKey } from './errors';
import { isValidEmail } from './email';

export type ResetOutcome = { status: 'sent' } | { status: 'error'; errorKey: AuthErrorKey };

/**
 * Forgot password. Always ends in the neutral confirmation, including for `auth/user-not-found`
 * (no account enumeration). Only malformed emails and network failures show an error. The event
 * is emitted once per submit that reaches Firebase.
 */
export async function requestPasswordReset(
  email: string,
  send: (email: string) => Promise<void> = (e) => sendPasswordResetEmail(getAuth(), e),
): Promise<ResetOutcome> {
  const trimmed = email.trim();
  if (!isValidEmail(trimmed)) return { status: 'error', errorKey: 'invalidEmail' };
  trackPasswordResetRequested();
  try {
    await send(trimmed);
    return { status: 'sent' };
  } catch (error) {
    const code = authErrorCode(error);
    if (code === 'auth/user-not-found') return { status: 'sent' };
    trackAuthFailed('email', 'reset', error);
    const key = authErrorKey(error);
    return { status: 'error', errorKey: key === 'invalidCredential' ? 'generic' : key };
  }
}
