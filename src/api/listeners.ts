import { setupListeners } from '@reduxjs/toolkit/query';
import type { ThunkDispatch, UnknownAction } from '@reduxjs/toolkit';
import * as Network from 'expo-network';
import { AppState } from 'react-native';

/**
 * RN has no window focus/online events, so feed RTK Query from AppState and expo-network.
 * Refetch itself is opt-in per subscription (`refetchOnFocus`/`refetchOnReconnect`).
 */
export function setupApiListeners(dispatch: ThunkDispatch<unknown, unknown, UnknownAction>) {
  return setupListeners(dispatch, (_d, actions) => {
    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') dispatch(actions.onFocus());
      else dispatch(actions.onFocusLost());
    });
    const netSub = Network.addNetworkStateListener((st) => {
      dispatch(st.isConnected ? actions.onOnline() : actions.onOffline());
    });
    return () => {
      appSub.remove();
      netSub.remove();
    };
  });
}
