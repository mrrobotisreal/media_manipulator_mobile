import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface QuotaMetricState {
  limit: number;
  remaining: number;
  resetAt: string | null;
  /** Epoch ms the headers were read; MA16 compares it with the /account/me fetch time. */
  observedAt: number;
}

export interface QuotaState {
  tier: string | null;
  metrics: Record<string, QuotaMetricState>;
}

/** What the baseQuery read from `X-MM-Tier` / `X-MM-Quota-*` on a 2xx response. */
export interface QuotaObservation {
  tier?: string;
  metric?: string;
  limit?: number;
  remaining?: number;
  resetAt?: string | null;
}

export const initialQuotaState: QuotaState = { tier: null, metrics: {} };

const quotaSlice = createSlice({
  name: 'quota',
  initialState: initialQuotaState,
  reducers: {
    observed(state, action: PayloadAction<QuotaObservation>) {
      const { tier, metric, limit, remaining, resetAt } = action.payload;
      if (tier) state.tier = tier;
      if (metric && limit !== undefined && remaining !== undefined) {
        state.metrics[metric] = {
          limit,
          remaining,
          resetAt: resetAt ?? null,
          observedAt: Date.now(),
        };
      }
    },
    reset() {
      return initialQuotaState;
    },
  },
});

export const { observed, reset } = quotaSlice.actions;
export default quotaSlice.reducer;
