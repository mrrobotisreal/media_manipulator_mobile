import {
  ALLOWED_EDGES,
  InvalidTransitionError,
  JOB_STATES,
  transition,
  type JobEvent,
  type JobEventType,
} from '../types';
import { record, snapshot } from '../testFixtures';

const err = { status: 429, code: 'quota_exceeded' as const, details: {} };
const EVENTS: Record<JobEventType, JobEvent> = {
  upload_start: { type: 'upload_start', at: 10 },
  progress: { type: 'progress', fraction: 0.4 },
  upload_sent: { type: 'upload_sent' },
  accepted: { type: 'accepted', jobId: 'job-1', at: 20 },
  snapshot: { type: 'snapshot', job: snapshot(), at: 30 },
  rejected: { type: 'rejected', error: err },
  upload_failed: { type: 'upload_failed', error: { ...err, code: 'network' } },
  interrupted: { type: 'interrupted' },
  retry: { type: 'retry' },
  lost: { type: 'lost', reason: 'server_restarted' },
  cancel: { type: 'cancel' },
  stop: { type: 'stop' },
};

describe('transition', () => {
  it('allows exactly the declared edges and throws on every other', () => {
    for (const state of JOB_STATES) {
      for (const type of Object.keys(EVENTS) as JobEventType[]) {
        const run = () => transition(record({ state }), EVENTS[type]);
        if (ALLOWED_EDGES[state].includes(type)) expect(run).not.toThrow();
        else expect(run).toThrow(InvalidTransitionError);
      }
    }
  });

  it('terminal states accept nothing', () => {
    for (const s of ['completed', 'failed', 'rejected', 'lost', 'cancelled', 'stopped'] as const) {
      expect(ALLOWED_EDGES[s]).toEqual([]);
    }
  });

  it('walks the multipart happy path', () => {
    let r = record();
    r = transition(r, EVENTS.upload_start);
    expect(r).toMatchObject({ state: 'uploading', uploadStartedAt: 10 });
    r = transition(r, EVENTS.progress);
    expect(r.uploadProgress).toBe(0.4);
    r = transition(r, EVENTS.accepted);
    expect(r).toMatchObject({
      state: 'pending',
      jobId: 'job-1',
      acceptedAt: 20,
      uploadProgress: 1,
    });
    r = transition(r, {
      type: 'snapshot',
      job: snapshot({ status: 'processing', progress: 40, currentStage: 'encode' }),
      at: 25,
    });
    expect(r).toMatchObject({ state: 'processing', progress: 40, stage: 'encode' });
    r = transition(r, { type: 'snapshot', job: snapshot({ status: 'completed' }), at: 30 });
    expect(r).toMatchObject({ state: 'completed', progress: 100, completedAt: 30 });
  });

  it('walks the presigned path through finalizing', () => {
    let r = record({ transport: 'presigned_put' });
    r = transition(transition(r, EVENTS.upload_start), EVENTS.upload_sent);
    expect(r.state).toBe('finalizing');
    expect(transition(r, EVENTS.accepted).state).toBe('pending');
  });

  it('clamps progress and failed snapshots keep the last progress', () => {
    const up = transition(record({ state: 'uploading' }), { type: 'progress', fraction: 3 });
    expect(up.uploadProgress).toBe(1);
    const f = transition(record({ state: 'processing', progress: 55 }), {
      type: 'snapshot',
      job: snapshot({ status: 'failed', error: 'boom' }),
      at: 9,
    });
    expect(f).toMatchObject({ state: 'failed', progress: 55, completedAt: 9 });
  });

  it('upload_failed is retryable and interrupted carries code interrupted', () => {
    const i = transition(record({ state: 'uploading' }), EVENTS.interrupted);
    expect(i).toMatchObject({ state: 'upload_failed', error: { code: 'interrupted' } });
    const q = transition(i, EVENTS.retry);
    expect(q).toMatchObject({ state: 'queued', uploadProgress: 0, error: undefined });
  });

  it('lost records the reason; cancel only before acceptance; stop only after', () => {
    expect(transition(record({ state: 'pending' }), EVENTS.lost)).toMatchObject({
      state: 'lost',
      lostReason: 'server_restarted',
    });
    expect(() => transition(record({ state: 'pending' }), EVENTS.cancel)).toThrow();
    expect(() => transition(record({ state: 'uploading' }), EVENTS.stop)).toThrow();
    expect(transition(record({ state: 'processing' }), EVENTS.stop).state).toBe('stopped');
  });
});
