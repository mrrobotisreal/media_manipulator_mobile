import { REHYDRATE } from 'redux-persist';
import { record } from '@/jobs/testFixtures';
import reducer, {
  JOBS_CAP,
  findJob,
  jobRemoved,
  jobUpserted,
  jobsReset,
  type JobsState,
} from '../slices/jobs';
import { mmkvStorage } from '../persist';
import { makeReadyStore } from '../testing';

const rec = (n: number, over = {}) => record({ localId: `local_${n}`, createdAt: n, ...over });

describe('jobs slice', () => {
  it('caps at 50, newest first, and cleans the jobId index', () => {
    let s = reducer(undefined, { type: 'init' });
    for (let i = 0; i < 60; i++) s = reducer(s, jobUpserted(rec(i, { jobId: `job-${i}` })));
    expect(s.order).toHaveLength(JOBS_CAP);
    expect(Object.keys(s.byLocalId)).toHaveLength(JOBS_CAP);
    expect(Object.keys(s.byJobId)).toHaveLength(JOBS_CAP);
    expect(s.order[0]).toBe('local_59');
    expect(s.byLocalId['local_0']).toBeUndefined();
    expect(s.byJobId['job-0']).toBeUndefined();
  });

  it('updates in place without reordering and indexes the server id', () => {
    let s = reducer(undefined, { type: 'init' });
    s = reducer(s, jobUpserted(rec(1)));
    s = reducer(s, jobUpserted(rec(2)));
    s = reducer(s, jobUpserted(rec(1, { jobId: 'srv', progress: 5 })));
    expect(s.order).toEqual(['local_2', 'local_1']);
    expect(findJob(s, 'srv')?.progress).toBe(5);
    expect(findJob(s, 'local_1')?.jobId).toBe('srv');
    expect(findJob(s, 'nope')).toBeUndefined();
  });

  it('removes and resets', () => {
    let s = reducer(undefined, jobUpserted(rec(1, { jobId: 'srv' })));
    s = reducer(s, jobRemoved('local_1'));
    expect(s).toEqual({ byLocalId: {}, order: [], byJobId: {} });
    s = reducer(s, jobUpserted(rec(2)));
    expect(reducer(s, jobsReset()).order).toEqual([]);
  });

  it('rehydrate turns queued/uploading/finalizing into upload_failed(interrupted)', () => {
    const persisted: JobsState = {
      byLocalId: {
        a: rec(1, { localId: 'a', state: 'uploading', watch: true }),
        b: rec(2, { localId: 'b', state: 'queued' }),
        c: rec(3, { localId: 'c', state: 'finalizing' }),
        d: rec(4, { localId: 'd', state: 'processing', jobId: 'srv-d' }),
        e: rec(5, { localId: 'e', state: 'completed', jobId: 'srv-e' }),
      },
      order: ['a', 'b', 'c', 'd', 'e'],
      byJobId: { 'srv-d': 'd', 'srv-e': 'e' },
    };
    const s = reducer(undefined, { type: REHYDRATE, key: 'jobs', payload: persisted });
    for (const id of ['a', 'b', 'c']) {
      expect(s.byLocalId[id]).toMatchObject({
        state: 'upload_failed',
        error: { code: 'interrupted' },
      });
    }
    expect(s.byLocalId['a']?.watch).toBe(false);
    expect(s.byLocalId['d']?.state).toBe('processing');
    expect(s.byLocalId['e']?.state).toBe('completed');
    expect(s.byJobId).toEqual({ 'srv-d': 'd', 'srv-e': 'e' });
  });

  it('rehydrate caps at 50 and ignores other persist keys', () => {
    const byLocalId: JobsState['byLocalId'] = {};
    const order: string[] = [];
    for (let i = 0; i < 70; i++) {
      byLocalId[`l${i}`] = rec(i, { localId: `l${i}` });
      order.push(`l${i}`);
    }
    const s = reducer(undefined, {
      type: REHYDRATE,
      key: 'jobs',
      payload: { byLocalId, order, byJobId: {} },
    });
    expect(s.order).toHaveLength(JOBS_CAP);
    const other = reducer(undefined, {
      type: REHYDRATE,
      key: 'settings',
      payload: { byLocalId, order },
    });
    expect(other.order).toEqual([]);
  });

  it('round-trips through the persisted store and applies the interrupted rule', async () => {
    const first = await makeReadyStore();
    first.store.dispatch(jobUpserted(rec(1, { state: 'uploading' })));
    first.store.dispatch(jobUpserted(rec(2, { state: 'processing', jobId: 'srv' })));
    await first.persistor.flush();
    expect(await mmkvStorage.getItem('persist:jobs')).toContain('local_1');
    const second = await makeReadyStore();
    const jobs = second.store.getState().jobs;
    expect(jobs.byLocalId['local_1']?.state).toBe('upload_failed');
    expect(jobs.byLocalId['local_2']?.state).toBe('processing');
    expect(jobs.byJobId['srv']).toBe('local_2');
  });
});
