import type { ConversionJob } from '@/api/schemas/job';
import type { MmError } from '@/api/errors';
import type { MediaKind, ToolOptions } from '@/tools/types';

/**
 * Job lifecycle (MA12 decision 3). Local states first, then the server's `pending | processing`,
 * then the terminal ones. `upload_failed` is the only non-terminal exit (retryable).
 */
export type JobState =
  | 'queued'
  | 'uploading'
  | 'finalizing'
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'rejected'
  | 'upload_failed'
  | 'lost'
  | 'cancelled'
  | 'stopped';

export const JOB_STATES: readonly JobState[] = [
  'queued',
  'uploading',
  'finalizing',
  'pending',
  'processing',
  'completed',
  'failed',
  'rejected',
  'upload_failed',
  'lost',
  'cancelled',
  'stopped',
];

export type JobTransportKind = 'post' | 'presigned_put';
export type LostReason = 'server_restarted' | 'expired';

export interface JobRecord {
  /** `local_<uuid>`; the record key before and after the server assigns `jobId`. */
  localId: string;
  jobId?: string;
  toolId: string;
  family: string;
  analyticsSlug: string;
  transport: JobTransportKind;
  /** IntakeFile id whose cache copy this job still needs (MA11's sweep reads it). */
  intakeFileId: string;
  /** What a retry (also after a relaunch) needs from the cache copy. Never sent to analytics. */
  fileUri: string;
  fileName: string;
  mimeType: string;
  sourceExtension: string;
  sizeBytes: number;
  mediaKind: MediaKind;
  /** The built API options (`tool.optionsBuilder(form)`), kept so a retry re-sends the same job. */
  options: ToolOptions;
  optionsHash: string;
  state: JobState;
  /** 0..1 */
  uploadProgress: number;
  /** 0..100, from the server */
  progress: number;
  stage?: string;
  createdAt: number;
  uploadStartedAt?: number;
  acceptedAt?: number;
  completedAt?: number;
  /** Last Zod-parsed server snapshot. */
  job?: ConversionJob;
  error?: MmError;
  lostReason?: LostReason;
  watch: boolean;
}

export type JobEvent =
  | { type: 'upload_start'; at: number }
  | { type: 'progress'; fraction: number }
  /** Presigned path: the PUT finished, `complete` is next. */
  | { type: 'upload_sent' }
  | { type: 'accepted'; jobId: string; at: number }
  | { type: 'snapshot'; job: ConversionJob; at: number }
  | { type: 'rejected'; error: MmError }
  | { type: 'upload_failed'; error: MmError }
  | { type: 'interrupted' }
  | { type: 'retry' }
  | { type: 'lost'; reason: LostReason }
  | { type: 'cancel' }
  | { type: 'stop' };

export type JobEventType = JobEvent['type'];

export const TERMINAL_STATES: readonly JobState[] = [
  'completed',
  'failed',
  'rejected',
  'lost',
  'cancelled',
  'stopped',
];

export const isTerminal = (s: JobState): boolean => TERMINAL_STATES.includes(s);
/** Accepted by the server and still running: the states the engine tracks. */
export const isServerActive = (s: JobState): boolean => s === 'pending' || s === 'processing';

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: JobState,
    readonly event: JobEventType,
  ) {
    super(`Invalid job transition: ${from} --${event}-->`);
    this.name = 'InvalidTransitionError';
  }
}

/** Every allowed (state, event) edge. Anything else throws `InvalidTransitionError`. */
export const ALLOWED_EDGES: Readonly<Record<JobState, readonly JobEventType[]>> = {
  queued: ['upload_start', 'cancel', 'rejected', 'interrupted'],
  uploading: [
    'progress',
    'upload_sent',
    'accepted',
    'rejected',
    'upload_failed',
    'interrupted',
    'cancel',
  ],
  finalizing: ['accepted', 'rejected', 'upload_failed', 'interrupted'],
  pending: ['snapshot', 'lost', 'stop'],
  processing: ['snapshot', 'lost', 'stop'],
  upload_failed: ['retry'],
  completed: [],
  failed: [],
  rejected: [],
  lost: [],
  cancelled: [],
  stopped: [],
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Pure reducer for one record. Returns a new record; throws on a forbidden edge. */
export function transition(r: JobRecord, e: JobEvent): JobRecord {
  if (!ALLOWED_EDGES[r.state].includes(e.type)) throw new InvalidTransitionError(r.state, e.type);
  switch (e.type) {
    case 'upload_start':
      return {
        ...r,
        state: 'uploading',
        uploadStartedAt: e.at,
        uploadProgress: 0,
        error: undefined,
      };
    case 'progress':
      return { ...r, uploadProgress: clamp01(e.fraction) };
    case 'upload_sent':
      return { ...r, state: 'finalizing', uploadProgress: 1 };
    case 'accepted':
      return {
        ...r,
        state: 'pending',
        jobId: e.jobId,
        acceptedAt: e.at,
        uploadProgress: 1,
        progress: 0,
      };
    case 'snapshot': {
      const { job } = e;
      const terminal = job.status === 'completed' || job.status === 'failed';
      return {
        ...r,
        state: job.status,
        job,
        progress: terminal && job.status === 'completed' ? 100 : (job.progress ?? r.progress),
        stage: job.currentStage ?? r.stage,
        completedAt: terminal ? e.at : r.completedAt,
      };
    }
    case 'rejected':
      return { ...r, state: 'rejected', error: e.error };
    case 'upload_failed':
      return { ...r, state: 'upload_failed', error: e.error };
    case 'interrupted':
      return {
        ...r,
        state: 'upload_failed',
        error: { status: 'FETCH_ERROR', code: 'interrupted', details: {} },
      };
    case 'retry':
      return { ...r, state: 'queued', uploadProgress: 0, error: undefined };
    case 'lost':
      return { ...r, state: 'lost', lostReason: e.reason, completedAt: r.completedAt };
    case 'cancel':
      return { ...r, state: 'cancelled' };
    case 'stop':
      return { ...r, state: 'stopped' };
  }
}
