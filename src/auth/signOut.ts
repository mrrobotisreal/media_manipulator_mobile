import type { Dispatch, UnknownAction } from '@reduxjs/toolkit';
import { reset as resetAnalytics, track } from '@/analytics/track';
import { mmApi } from '@/api/mmApi';
import { jobsReset } from '@/state/slices/jobs';
import { reset as quotaReset } from '@/state/slices/quota';
import { sessionStarted } from '@/state/slices/session';
import { setAuthEntrySource } from './analytics';
import { firebaseSignOut } from './firebase';
import { googleSignOut } from './google';

export interface SignOutDeps {
  firebaseSignOut: () => Promise<void>;
  googleSignOut: () => Promise<void>;
}

const realDeps: SignOutDeps = { firebaseSignOut, googleSignOut };

/**
 * AUTH_AND_IDENTITY §4. Order: `signout` event, analytics reset, Firebase, Google, then local state
 * (RTK cache, jobs, quota) and a rotated `sessionId`; `visitorId` is kept.
 */
export async function performSignOut(
  dispatch: Dispatch<UnknownAction>,
  deps: SignOutDeps = realDeps,
): Promise<void> {
  track('signout');
  setAuthEntrySource('signed_out');
  resetAnalytics();
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
