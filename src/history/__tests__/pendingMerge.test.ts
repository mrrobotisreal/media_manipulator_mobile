import { record } from '@/jobs/testFixtures';
import { pendingRecords } from '../pendingMerge';

describe('pendingRecords', () => {
  const recs = [
    record({ localId: 'l1', state: 'uploading', createdAt: 10 }),
    record({ localId: 'l2', state: 'processing', jobId: 's2', createdAt: 30 }),
    record({ localId: 'l3', state: 'processing', jobId: 's3', createdAt: 20 }),
    record({ localId: 'l4', state: 'cancelled', createdAt: 40 }),
    record({ localId: 'l5', state: 'stopped', jobId: 's5', createdAt: 41 }),
    record({ localId: 'l6', state: 'lost', jobId: 's6', createdAt: 42 }),
    record({ localId: 'l7', state: 'completed', jobId: 's7', createdAt: 43 }),
    record({ localId: 'l8', state: 'upload_failed', createdAt: 5 }),
    record({ localId: 'l9', state: 'failed', jobId: 's9', createdAt: 44 }),
  ];

  it('keeps in-flight states newest first and drops terminal/stopped ones', () => {
    expect(pendingRecords(recs, new Set()).map((r) => r.localId)).toEqual(['l2', 'l3', 'l1', 'l8']);
  });

  it('the server row wins once a loaded page lists the jobId', () => {
    expect(pendingRecords(recs, new Set(['s2'])).map((r) => r.localId)).toEqual(['l3', 'l1', 'l8']);
  });
});
