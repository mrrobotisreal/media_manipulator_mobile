import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { uuidv4 } from '@/lib/ids';

export interface SessionState {
  visitorId: string;
  sessionId: string;
  lastActiveAt: number;
}

export const initialSessionState = (): SessionState => ({
  visitorId: uuidv4(),
  sessionId: uuidv4(),
  lastActiveAt: Date.now(),
});

const sessionSlice = createSlice({
  name: 'session',
  initialState: initialSessionState,
  reducers: {
    touched(state, action: PayloadAction<number>) {
      state.lastActiveAt = action.payload;
    },
    /** New session id (sign-out, AUTH §4). */
    sessionStarted(state) {
      state.sessionId = uuidv4();
      state.lastActiveAt = Date.now();
    },
    /**
     * A new anonymous visitor identity (MA22): after a DSR analytics delete or account deletion the old
     * `visitorId` must never reach the analytics service again, or the erasure would un-erase itself.
     */
    visitorRotated(state) {
      state.visitorId = uuidv4();
      state.sessionId = uuidv4();
      state.lastActiveAt = Date.now();
    },
    /** 30-minute idle rotation (MA07 `src/analytics/session.ts`); the API headers read the new id. */
    sessionRotated(state, action: PayloadAction<number>) {
      state.sessionId = uuidv4();
      state.lastActiveAt = action.payload;
    },
  },
});

export const { touched, sessionStarted, sessionRotated, visitorRotated } = sessionSlice.actions;
export default sessionSlice.reducer;
