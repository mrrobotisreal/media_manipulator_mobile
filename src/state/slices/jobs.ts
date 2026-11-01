import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { REHYDRATE } from 'redux-persist';
import type { JobRecord } from '@/jobs/types';

export const JOBS_CAP = 50;

export interface JobsState {
  /** Keyed by `localId`. */
  byLocalId: Record<string, JobRecord>;
  /** Newest first. */
  order: string[];
  /** Server `jobId` -> `localId`. */
  byJobId: Record<string, string>;
}

export const initialJobsState = (): JobsState => ({ byLocalId: {}, order: [], byJobId: {} });

/** Newest first; drops entries beyond the cap. */
export function enforceCap(state: JobsState, cap = JOBS_CAP): void {
  while (state.order.length > cap) {
    const dropped = state.order.pop();
    if (!dropped) break;
    const rec = state.byLocalId[dropped];
    if (rec?.jobId) delete state.byJobId[rec.jobId];
    delete state.byLocalId[dropped];
  }
}

/**
 * Rehydrate rule (decision 4): an upload cannot survive a process death on Android, so anything
 * that was queued, uploading or finalizing becomes `upload_failed` / `interrupted`. The retry
 * button depends on the intake copy still existing (the engine checks). `watch` is in-memory only.
 */
export function rehydrateJobs(persisted: unknown): JobsState | null {
  const p = persisted as Partial<JobsState> | undefined;
  if (!p || typeof p !== 'object' || !p.byLocalId || !Array.isArray(p.order)) return null;
  const byLocalId: Record<string, JobRecord> = {};
  const byJobId: Record<string, string> = {};
  const order: string[] = [];
  for (const id of p.order.slice(0, JOBS_CAP)) {
    const rec = p.byLocalId[id];
    if (!rec) continue;
    const next: JobRecord = { ...rec, watch: false };
    if (rec.state === 'queued' || rec.state === 'uploading' || rec.state === 'finalizing') {
      next.state = 'upload_failed';
      next.error = { status: 'FETCH_ERROR', code: 'interrupted', details: { rehydrated: true } };
    }
    byLocalId[id] = next;
    order.push(id);
    if (next.jobId) byJobId[next.jobId] = id;
  }
  return { byLocalId, order, byJobId };
}

const jobsSlice = createSlice({
  name: 'jobs',
  initialState: initialJobsState,
  reducers: {
    /** Insert (newest first) or replace by `localId`. */
    jobUpserted(state, action: PayloadAction<JobRecord>) {
      const rec = action.payload;
      if (!state.byLocalId[rec.localId]) state.order.unshift(rec.localId);
      state.byLocalId[rec.localId] = rec;
      if (rec.jobId) state.byJobId[rec.jobId] = rec.localId;
      enforceCap(state);
    },
    jobRemoved(state, action: PayloadAction<string>) {
      const rec = state.byLocalId[action.payload];
      if (rec?.jobId) delete state.byJobId[rec.jobId];
      delete state.byLocalId[action.payload];
      state.order = state.order.filter((id) => id !== action.payload);
    },
    /** Sign-out: drop every tracked job. */
    jobsReset() {
      return initialJobsState();
    },
  },
  extraReducers: (builder) => {
    builder.addMatcher(
      (a): a is { type: string; key: string; payload?: unknown } =>
        a.type === REHYDRATE && (a as { key?: string }).key === 'jobs',
      (state, action) => rehydrateJobs(action.payload) ?? state,
    );
  },
});

export const { jobUpserted, jobRemoved, jobsReset } = jobsSlice.actions;
export default jobsSlice.reducer;

/** Finds a record by local id or server job id (the job route accepts either). */
export function findJob(state: JobsState, id: string | undefined): JobRecord | undefined {
  if (!id) return undefined;
  return state.byLocalId[id] ?? state.byLocalId[state.byJobId[id] ?? ''];
}
