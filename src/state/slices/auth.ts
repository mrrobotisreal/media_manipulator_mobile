import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type AuthStatus = 'unknown' | 'signedOut' | 'syncing' | 'ready' | 'syncFailed';

export interface AuthIdentity {
  uid: string;
  email: string | null;
  displayName: string | null;
  providerIds: string[];
  emailVerified: boolean;
}

/** One-shot messages shown after a redirect (sign-in screen / Tools tab). */
export type AuthNotice = 'sessionExpired' | 'linked';

export interface AuthState {
  status: AuthStatus;
  uid: string | null;
  email: string | null;
  displayName: string | null;
  providerIds: string[];
  emailVerified: boolean;
  notice: AuthNotice | null;
  /** Offer to link Apple after sign-in (Android web flow has no pending credential to link). */
  appleLinkOffer: boolean;
  /** Linking sheet: the method whose sign-in hit an existing account with another provider. */
  linkPrompt: 'google' | 'apple' | null;
}

export const initialAuthState: AuthState = {
  status: 'unknown',
  uid: null,
  email: null,
  displayName: null,
  providerIds: [],
  emailVerified: false,
  notice: null,
  appleLinkOffer: false,
  linkPrompt: null,
};

const authSlice = createSlice({
  name: 'auth',
  initialState: initialAuthState,
  reducers: {
    statusChanged(state, action: PayloadAction<AuthStatus>) {
      state.status = action.payload;
    },
    /**
     * Dispatched by the API baseQuery after a forced token refresh still gets 401.
     * No state change here; MA04 listens and signs the user out.
     */
    sessionExpired() {},
    /** Firebase user changed (or signed out when null). Leaves `status` and `notice` alone. */
    identityChanged(state, action: PayloadAction<AuthIdentity | null>) {
      const id = action.payload;
      state.uid = id?.uid ?? null;
      state.email = id?.email ?? null;
      state.displayName = id?.displayName ?? null;
      state.providerIds = id?.providerIds ?? [];
      state.emailVerified = id?.emailVerified ?? false;
    },
    appleLinkOfferSet(state, action: PayloadAction<boolean>) {
      state.appleLinkOffer = action.payload;
    },
    linkPromptSet(state, action: PayloadAction<'google' | 'apple' | null>) {
      state.linkPrompt = action.payload;
    },
    noticeSet(state, action: PayloadAction<AuthNotice | null>) {
      state.notice = action.payload;
    },
  },
});

export const {
  statusChanged,
  identityChanged,
  noticeSet,
  appleLinkOfferSet,
  linkPromptSet,
  sessionExpired,
} = authSlice.actions;
export default authSlice.reducer;
