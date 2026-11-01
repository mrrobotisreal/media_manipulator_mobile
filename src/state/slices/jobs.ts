import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export const JOBS_CAP = 50;

export interface JobEntry {
  jobId: string;
  toolId: string;
  family: string;
  status: string;
  progress: number;
  createdAt: number;
}

export interface JobsState {
  byId: Record<string, JobEntry>;
  order: string[];
}

/** Newest first; drops entries beyond the cap. */
export function enforceCap(state: JobsState, cap = JOBS_CAP): void {
  while (state.order.length > cap) {
    const dropped = state.order.pop();
    if (dropped) delete state.byId[dropped];
  }
}

const jobsSlice = createSlice({
  name: 'jobs',
  initialState: { byId: {}, order: [] } as JobsState,
  reducers: {
    jobUpserted(state, action: PayloadAction<JobEntry>) {
      const job = action.payload;
      if (!state.byId[job.jobId]) state.order.unshift(job.jobId);
      state.byId[job.jobId] = job;
      enforceCap(state);
    },
    /** Sign-out: drop every tracked job. */
    jobsReset() {
      return { byId: {}, order: [] } as JobsState;
    },
    jobRemoved(state, action: PayloadAction<string>) {
      delete state.byId[action.payload];
      state.order = state.order.filter((id) => id !== action.payload);
    },
  },
});

export const { jobUpserted, jobRemoved, jobsReset } = jobsSlice.actions;
export default jobsSlice.reducer;
