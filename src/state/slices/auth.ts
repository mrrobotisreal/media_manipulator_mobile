import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type AuthStatus = 'unknown' | 'signedOut' | 'syncing' | 'ready' | 'syncFailed';

export interface AuthState {
  status: AuthStatus;
  uid: string | null;
  email: string | null;
  displayName: string | null;
  providerIds: string[];
  emailVerified: boolean;
}

export const initialAuthState: AuthState = {
  status: 'unknown',
  uid: null,
  email: null,
  displayName: null,
  providerIds: [],
  emailVerified: false,
};

const authSlice = createSlice({
  name: 'auth',
  initialState: initialAuthState,
  reducers: {
    statusChanged(state, action: PayloadAction<AuthStatus>) {
      state.status = action.payload;
    },
    /** Dev-only shell skip, deleted by MA04. No-op outside __DEV__. */
    devShellEntered(state) {
      if (__DEV__) state.status = 'ready';
    },
  },
});

export const { statusChanged, devShellEntered } = authSlice.actions;
export default authSlice.reducer;
