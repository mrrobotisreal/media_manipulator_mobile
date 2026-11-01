import { GoogleAuthProvider, type AuthCredential } from '@react-native-firebase/auth';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';

let configured = false;

/** Web client id from `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`; undefined hides the Google button. */
export function googleWebClientId(): string | undefined {
  const id = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  return id && id.length > 0 ? id : undefined;
}

export function isGoogleAvailable(): boolean {
  return googleWebClientId() !== undefined;
}

/** Idempotent; call once at startup. Missing client id logs a dev-only warning. */
export function configureGoogle(): void {
  if (configured) return;
  const webClientId = googleWebClientId();
  if (!webClientId) {
    if (__DEV__)
      console.warn('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not set; Google sign-in is hidden.');
    return;
  }
  GoogleSignin.configure({ webClientId });
  configured = true;
}

/**
 * Runs the Google account picker and returns a Firebase credential, or `null` when the user
 * cancelled (silent: no `auth_failed`). Other failures throw with `code` set.
 */
export async function getGoogleCredential(): Promise<AuthCredential | null> {
  configureGoogle();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  try {
    const response = await GoogleSignin.signIn();
    if (response.type === 'cancelled') return null;
    const idToken = response.data.idToken;
    if (!idToken) throw Object.assign(new Error('no id token'), { code: 'google/no-id-token' });
    return GoogleAuthProvider.credential(idToken);
  } catch (error) {
    if ((error as { code?: unknown }).code === statusCodes.SIGN_IN_CANCELLED) return null;
    throw error;
  }
}

export async function googleSignOut(): Promise<void> {
  try {
    await GoogleSignin.signOut();
  } catch {
    // Ignored on purpose: the Firebase session is already gone.
  }
}
