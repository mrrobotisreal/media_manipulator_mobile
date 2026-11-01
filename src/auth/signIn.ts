/**
 * Sign-in orchestration: provider flow -> Firebase credential -> `signInWithCredential`, with
 * analytics, linking and sync hints. Screens call these and only look at the outcome.
 */
import type { Dispatch, UnknownAction } from '@reduxjs/toolkit';
import {
  getAdditionalUserInfo,
  getAuth,
  signInWithCredential,
  updateProfile,
  type AuthCredential,
  type UserCredential,
} from '@react-native-firebase/auth';
import { linkPromptSet } from '@/state/slices/auth';
import { trackAuthFailed, trackAuthSuccess, trackSignupStarted, type AuthMode } from './analytics';
import { getAppleNativeCredential, isAppleNative, signInWithAppleAndroid } from './apple';
import { signInWithEmail, signUpWithEmail } from './email';
import { authErrorKey, errorEmail, isAccountExistsError, type AuthErrorKey } from './errors';
import { currentUser, toIdentity } from './firebase';
import { getGoogleCredential } from './google';
import { completePendingLink, setPendingLink } from './linking';
import type { AuthMethod } from './methods';
import { getSyncGate } from './gate';
import { clearSignInHint, hintSignIn } from './syncGate';

export type SignInOutcome =
  | { status: 'success'; isNewUser: boolean }
  | { status: 'cancelled' }
  /** An account with this email exists under another provider: show the linking sheet. */
  | { status: 'link'; method: 'google' | 'apple'; email?: string }
  | { status: 'error'; errorKey: AuthErrorKey };

type D = Dispatch<UnknownAction>;

async function finish(
  method: AuthMethod,
  result: UserCredential,
  isNewUser: boolean,
  dispatch: D,
): Promise<SignInOutcome> {
  trackAuthSuccess(method, isNewUser);
  await completePendingLink(result.user, dispatch);
  return { status: 'success', isNewUser };
}

function fail(method: AuthMethod, stage: 'provider' | 'credential', error: unknown): SignInOutcome {
  clearSignInHint();
  trackAuthFailed(method, stage, error);
  return { status: 'error', errorKey: authErrorKey(error) };
}

async function credentialSignIn(
  method: 'google' | 'apple',
  credential: AuthCredential,
  displayName: string | undefined,
  dispatch: D,
): Promise<SignInOutcome> {
  hintSignIn(method, displayName);
  let result: UserCredential;
  try {
    result = await signInWithCredential(getAuth(), credential);
  } catch (error) {
    if (isAccountExistsError(error)) {
      clearSignInHint();
      trackAuthFailed(method, 'credential', error);
      setPendingLink({ credential, method, email: errorEmail(error) });
      dispatch(linkPromptSet(method));
      return { status: 'link', method, email: errorEmail(error) };
    }
    return fail(method, 'credential', error);
  }
  return finish(method, result, getAdditionalUserInfo(result)?.isNewUser ?? false, dispatch);
}

export async function signInWithGoogle(mode: AuthMode, dispatch: D): Promise<SignInOutcome> {
  if (mode === 'signup') trackSignupStarted('google');
  let credential: AuthCredential | null;
  try {
    credential = await getGoogleCredential();
  } catch (error) {
    return fail('google', 'provider', error);
  }
  if (!credential) return { status: 'cancelled' };
  return credentialSignIn('google', credential, undefined, dispatch);
}

export async function signInWithApple(mode: AuthMode, dispatch: D): Promise<SignInOutcome> {
  if (mode === 'signup') trackSignupStarted('apple');
  if (isAppleNative()) {
    let native;
    try {
      native = await getAppleNativeCredential();
    } catch (error) {
      return fail('apple', 'provider', error);
    }
    if (!native) return { status: 'cancelled' };
    const outcome = await credentialSignIn(
      'apple',
      native.credential,
      native.displayName,
      dispatch,
    );
    if (outcome.status === 'success' && native.displayName && !currentUser()?.displayName) {
      await storeDisplayName(native.displayName);
    }
    return outcome;
  }
  // Android: Custom Tab flow.
  hintSignIn('apple');
  try {
    const { result, displayName } = await signInWithAppleAndroid();
    if (displayName) {
      hintSignIn('apple', displayName);
      await storeDisplayName(displayName);
    }
    return finish('apple', result, getAdditionalUserInfo(result)?.isNewUser ?? false, dispatch);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'auth/web-context-cancelled' || code === 'auth/cancelled-popup-request') {
      clearSignInHint();
      return { status: 'cancelled' };
    }
    if (isAccountExistsError(error)) {
      clearSignInHint();
      trackAuthFailed('apple', 'credential', error);
      // The web flow gives us no credential to link later; offer "Link Apple" after they sign in.
      setPendingLink({ credential: null, method: 'apple', email: errorEmail(error) });
      dispatch(linkPromptSet('apple'));
      return { status: 'link', method: 'apple', email: errorEmail(error) };
    }
    return fail('apple', 'provider', error);
  }
}

/** Writes the display name Apple returned once, then re-syncs so the server has it. */
async function storeDisplayName(name: string): Promise<void> {
  const user = currentUser();
  if (!user) return;
  try {
    await updateProfile(user, { displayName: name });
    const fresh = currentUser();
    if (fresh) getSyncGate()?.resync(toIdentity(fresh));
  } catch {
    // Name is a nicety; sync already has it from the hint on iOS.
  }
}

export async function signInWithEmailFlow(
  email: string,
  password: string,
  dispatch: D,
): Promise<SignInOutcome> {
  hintSignIn('email');
  try {
    const result = await signInWithEmail(email, password);
    return finish('email', result, false, dispatch);
  } catch (error) {
    return fail('email', 'credential', error);
  }
}

export async function signUpWithEmailFlow(
  email: string,
  password: string,
  displayName: string,
  dispatch: D,
): Promise<SignInOutcome> {
  trackSignupStarted('email');
  hintSignIn('email', displayName.trim());
  try {
    const result = await signUpWithEmail(email, password, displayName);
    return finish('email', result, true, dispatch);
  } catch (error) {
    return fail('email', 'credential', error);
  }
}
