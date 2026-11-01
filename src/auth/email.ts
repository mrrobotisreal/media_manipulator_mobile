import {
  EmailAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  sendEmailVerification,
  signInWithEmailAndPassword,
  updateProfile,
  type UserCredential,
} from '@react-native-firebase/auth';
import { currentUser } from './firebase';

export const PASSWORD_MIN = 8;
export const NAME_MAX = 80;

// Pragmatic client-side check; Firebase is the authority.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

export function isValidDisplayName(name: string): boolean {
  const n = name.trim();
  return n.length >= 1 && n.length <= NAME_MAX;
}

export function isValidPassword(password: string): boolean {
  return password.length >= PASSWORD_MIN;
}

export function signInWithEmail(email: string, password: string): Promise<UserCredential> {
  return signInWithEmailAndPassword(getAuth(), email.trim(), password);
}

/** Creates the account, then stores the display name so sync and Firebase agree. */
export async function signUpWithEmail(
  email: string,
  password: string,
  displayName: string,
): Promise<UserCredential> {
  const result = await createUserWithEmailAndPassword(getAuth(), email.trim(), password);
  await updateProfile(result.user, { displayName: displayName.trim() });
  return result;
}

export function emailCredential(email: string, password: string) {
  return EmailAuthProvider.credential(email, password);
}

export async function sendVerificationEmail(): Promise<void> {
  const user = currentUser();
  if (!user) throw new Error('not signed in');
  await sendEmailVerification(user);
}
