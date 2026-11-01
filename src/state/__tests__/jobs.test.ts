import reducer, { JOBS_CAP, jobUpserted, type JobEntry } from '../slices/jobs';

const job = (n: number): JobEntry => ({
  jobId: `job-${n}`,
  toolId: 't',
  family: 'video',
  status: 'queued',
  progress: 0,
  createdAt: n,
});

describe('jobs slice', () => {
  it('caps at 50, newest first', () => {
    let state = reducer(undefined, { type: 'init' });
    for (let i = 0; i < 60; i++) state = reducer(state, jobUpserted(job(i)));
    expect(state.order).toHaveLength(JOBS_CAP);
    expect(Object.keys(state.byId)).toHaveLength(JOBS_CAP);
    expect(state.order[0]).toBe('job-59');
    expect(state.byId['job-0']).toBeUndefined();
  });

  it('updates in place without reordering', () => {
    let state = reducer(undefined, { type: 'init' });
    state = reducer(state, jobUpserted(job(1)));
    state = reducer(state, jobUpserted(job(2)));
    state = reducer(state, jobUpserted({ ...job(1), progress: 0.5 }));
    expect(state.order).toEqual(['job-2', 'job-1']);
    expect(state.byId['job-1']?.progress).toBe(0.5);
  });
});
