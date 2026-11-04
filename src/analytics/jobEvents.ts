import type { ConversionJob } from '@/api/schemas/job';
import { catalogKind } from './fileEvents';
import { EVENTS } from './events';
import { track, type EventProps } from './track';
import type { JobRecord } from '@/jobs/types';

/** Starter jobs (MA50) emit no upload events; the narrowing keeps the catalog's two values. */
const transportOf = (r: JobRecord) => (r.transport === 'starter' ? undefined : r.transport);

/** Event context: ambient tool screen state is gone by the time a job finishes. */
function ctx(r: JobRecord, withJobId = true): EventProps {
  return {
    tool_slug: r.analyticsSlug,
    media_kind: catalogKind(r.mediaKind),
    ...(withJobId && r.jobId ? { job_id: r.jobId } : {}),
  };
}

export function trackUploadStarted(r: JobRecord): void {
  track(
    EVENTS.UPLOAD_STARTED,
    { size_bytes: r.sizeBytes, transport: transportOf(r) },
    ctx(r, false),
  );
}

export function trackUploadCompleted(r: JobRecord, durationMs: number): void {
  track(
    EVENTS.UPLOAD_COMPLETED,
    { size_bytes: r.sizeBytes, duration_ms: durationMs, transport: transportOf(r) },
    ctx(r, false),
  );
}

/** `reason` = `MmError.code`, or `network` / `s3_put` / `interrupted` / `cancelled`. Never file names. */
export function trackUploadFailed(
  r: JobRecord,
  reason: string,
  durationMs: number,
  status?: number,
): void {
  track(
    EVENTS.UPLOAD_FAILED,
    {
      reason,
      status,
      size_bytes: r.sizeBytes,
      duration_ms: durationMs,
      transport: transportOf(r),
    },
    ctx(r, false),
  );
}

export function trackJobStarted(r: JobRecord): void {
  const target = r.options.format;
  track(
    EVENTS.JOB_STARTED,
    {
      job_id: r.jobId,
      options_hash: r.optionsHash,
      target_format: typeof target === 'string' ? target : undefined,
      source_format: r.sourceExtension || 'unknown',
    },
    ctx(r),
  );
}

const extOf = (name?: string) => {
  const i = name?.lastIndexOf('.') ?? -1;
  return name && i > 0 ? name.slice(i + 1).toLowerCase() : undefined;
};

export function trackJobCompleted(r: JobRecord, job: ConversionJob, durationMs: number): void {
  track(
    EVENTS.JOB_COMPLETED,
    {
      job_id: r.jobId,
      duration_ms: durationMs,
      output_bytes: job.resultSizeBytes,
      output_format: extOf(job.resultFileName),
      queue_wait_ms: job.queueWaitMs,
    },
    ctx(r),
  );
}

/**
 * `reason` is a fixed vocabulary, never the server's free-text `error` (it can echo file names).
 * `stage` = the pipeline stage the job was in.
 */
export function trackJobFailed(r: JobRecord, job: ConversionJob, durationMs: number): void {
  track(
    EVENTS.JOB_FAILED,
    {
      job_id: r.jobId,
      duration_ms: durationMs,
      reason: 'processing_failed',
      stage: job.currentStage,
    },
    ctx(r),
  );
}

export type HoursSinceSignupBucket = '<1h' | '1-24h' | '1-7d' | '7d+';

export function hoursSinceSignupBucket(ms: number): HoursSinceSignupBucket {
  const h = ms / 3_600_000;
  if (h < 1) return '<1h';
  if (h < 24) return '1-24h';
  if (h < 168) return '1-7d';
  return '7d+';
}

export function trackActivation(r: JobRecord, signupAtMs: number | null, now: number): void {
  track(
    EVENTS.ACTIVATION_FIRST_JOB_COMPLETED,
    {
      tool_slug: r.analyticsSlug,
      media_kind: catalogKind(r.mediaKind),
      hours_since_signup: signupAtMs === null ? null : hoursSinceSignupBucket(now - signupAtMs),
      guest: false,
    },
    ctx(r),
  );
}
