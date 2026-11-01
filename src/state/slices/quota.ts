import { createSlice } from '@reduxjs/toolkit';

export interface QuotaState {
  tier: string | null;
  metrics: Record<string, { limit: number; remaining: number; resetAt: string | null }>;
}

const quotaSlice = createSlice({
  name: 'quota',
  initialState: { tier: null, metrics: {} } as QuotaState,
  reducers: {},
});

export default quotaSlice.reducer;
