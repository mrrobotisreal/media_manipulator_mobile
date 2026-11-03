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
    /** 30-minute idle rotation (MA07 `src/analytics/session.ts`); the API headers read the new id. */
    sessionRotated(state, action: PayloadAction<number>) {
      state.sessionId = uuidv4();
      state.lastActiveAt = action.payload;
    },
  },
});

export const { touched, sessionStarted, sessionRotated } = sessionSlice.actions;
export default sessionSlice.reducer;
