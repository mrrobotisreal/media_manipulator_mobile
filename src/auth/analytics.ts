/**
 * Auth analytics through MA03's stub (MA07 makes it real). Properties are method / stage / reason
 * codes only: never an email, a name or a raw error message.
 */
import { EVENTS } from '@/analytics/events';
import { track } from '@/analytics/track';
import { authErrorCode } from './errors';
import type { AuthMethod } from './methods';

export type AuthStage = 'provider' | 'credential' | 'sync' | 'link' | 'reset';
export type AuthMode = 'signin' | 'signup';
export type AuthEntrySource = 'launch' | 'signed_out' | 'session_expired';

let entrySource: AuthEntrySource = 'launch';

/** Why the auth screen is about to show; consumed by the next `auth_modal_opened`. */
export function setAuthEntrySource(source: AuthEntrySource): void {
  entrySource = source;
}

export function trackAuthScreenShown(mode: AuthMode): void {
  track(EVENTS.AUTH_MODAL_OPENED, { source: entrySource, mode });
}

export function trackSignupStarted(method: AuthMethod): void {
  track(EVENTS.SIGNUP_STARTED, { method });
}

export function trackAuthSuccess(method: AuthMethod, isNewUser: boolean): void {
  track(isNewUser ? EVENTS.SIGNUP_COMPLETED : EVENTS.SIGNIN_COMPLETED, { method });
}

export function trackAuthFailed(method: AuthMethod, stage: AuthStage, error: unknown): void {
  track(EVENTS.AUTH_FAILED, { method, stage, reason: authErrorCode(error) });
}

export function trackPasswordResetRequested(): void {
  track(EVENTS.PASSWORD_RESET_REQUESTED, { surface: 'app' });
}
