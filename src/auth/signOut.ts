import type { Dispatch, UnknownAction } from '@reduxjs/toolkit';
import { EVENTS } from '@/analytics/events';
import { reset as resetAnalytics, track } from '@/analytics/track';
import { mmApi } from '@/api/mmApi';
import { jobsReset } from '@/state/slices/jobs';
import { reset as quotaReset } from '@/state/slices/quota';
import { sessionStarted } from '@/state/slices/session';
import { setAuthEntrySource } from './analytics';
import { firebaseSignOut } from './firebase';
import { googleSignOut } from './google';
import { releasePushToken } from '@/push/runtime';
import type { AppDispatch } from '@/state/store';

export interface SignOutDeps {
  firebaseSignOut: () => Promise<void>;
  googleSignOut: () => Promise<void>;
  /**
   * MA24: removes this device's push token. Runs BEFORE `firebaseSignOut` (the DELETE needs the Bearer)
   * and must never throw or block sign-out. `server:false` skips the DELETE (the Bearer is gone).
   */
  releasePush?: (dispatch: Dispatch<UnknownAction>, opts: { server: boolean }) => Promise<void>;
}

const realDeps: SignOutDeps = {
  firebaseSignOut,
  googleSignOut,
  releasePush: (dispatch, opts) => releasePushToken(dispatch as AppDispatch, opts),
};

/**
 * AUTH_AND_IDENTITY §4. Order: `signout` event, analytics reset, Firebase, Google, then local state
 * (RTK cache, jobs, quota) and a rotated `sessionId`; `visitorId` is kept.
 */
export async function performSignOut(
  dispatch: Dispatch<UnknownAction>,
  deps: SignOutDeps = realDeps,
  opts: { silent?: boolean; pushServer?: boolean } = {},
): Promise<void> {
  // `silent`: account deletion already reset analytics and must not queue another event (MA22).
  if (!opts.silent) {
    track(EVENTS.SIGNOUT);
    setAuthEntrySource('signed_out');
    resetAnalytics();
  }
  // `silent` is account deletion: the server rows cascaded and finishAccountDeletion deletes the device token.
  if (!opts.silent) {
    await deps
      .releasePush?.(dispatch, { server: opts.pushServer !== false })
      .catch(() => undefined);
  }
  try {
    await deps.firebaseSignOut();
  } finally {
    await deps.googleSignOut();
    dispatch(mmApi.util.resetApiState());
    dispatch(jobsReset());
    dispatch(quotaReset());
    dispatch(sessionStarted());
  }
}
