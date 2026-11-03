/** Wires the sync gate and the session-expired listener to the real store and Firebase. */
import { createListenerMiddleware } from '@reduxjs/toolkit';
import type { AppDispatch, RootState } from '@/state/store';
import { accountApi } from '@/api/endpoints/account';
import { getRequestLocale } from '@/lib/locale';
import { sessionExpired, noticeSet } from '@/state/slices/auth';
import { isFirebaseConfigured } from '@/lib/firebaseAvailable';
import { configureGoogle } from './google';
import { createSyncGate, type SyncGate } from './syncGate';
import { onAuthChanged, registerTokenProvider, toIdentity } from './firebase';
import { performSignOut } from './signOut';

/** Middleware added to the store: MA03's `auth/sessionExpired` signs the user out. */
export const authListener = createListenerMiddleware();
authListener.startListening({
  actionCreator: sessionExpired,
  effect: async (_action, api) => {
    const state = api.getState() as RootState;
    // A 401 during the sync gate is handled there (-> syncFailed); signed-out users have nothing to expire.
    if (state.auth.status === 'syncing' || state.auth.status === 'signedOut') return;
    api.dispatch(noticeSet('sessionExpired'));
    // The Bearer is already rejected: skip the push-token DELETE (MA24).
    await performSignOut(api.dispatch as AppDispatch, undefined, { pushServer: false });
  },
});

let gate: SyncGate | null = null;

export function getSyncGate(): SyncGate | null {
  return gate;
}

/** Called once from the root layout. Returns a cleanup. */
export function startAuth(store: { dispatch: AppDispatch; getState: () => RootState }): () => void {
  if (!isFirebaseConfigured()) {
    // No Firebase in this build: nobody can sign in. Show the sign-in screen's unavailable state.
    store.dispatch({ type: 'auth/statusChanged', payload: 'signedOut' });
    return () => {};
  }
  registerTokenProvider();
  configureGoogle();
  gate = createSyncGate({
    onAuthChanged: (cb) => onAuthChanged((user) => cb(user ? toIdentity(user) : null)),
    dispatch: store.dispatch,
    getStatus: () => store.getState().auth.status,
    sync: (body) => store.dispatch(accountApi.endpoints.syncAccount.initiate(body)).unwrap(),
    prefetchMe: () => {
      void store.dispatch(
        accountApi.endpoints.getAccountMe.initiate(undefined, { forceRefetch: true }),
      );
    },
    getLocale: () => getRequestLocale(store.getState()),
  });
  return gate.start();
}
