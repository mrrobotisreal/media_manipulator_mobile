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
    /** New session id (cold start); rotation policy arrives in MA07. */
    sessionStarted(state) {
      state.sessionId = uuidv4();
      state.lastActiveAt = Date.now();
    },
  },
});

export const { touched, sessionStarted } = sessionSlice.actions;
export default sessionSlice.reducer;
