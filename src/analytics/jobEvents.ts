import type { ConversionJob } from '@/api/schemas/job';
import { catalogKind } from './fileEvents';
import { track, type EventProps } from './track';
import type { JobRecord } from '@/jobs/types';

/** Event context: ambient tool screen state is gone by the time a job finishes. */
function ctx(r: JobRecord, withJobId = true): EventProps {
  return {
    tool_slug: r.analyticsSlug,
    media_kind: catalogKind(r.mediaKind),
    ...(withJobId && r.jobId ? { job_id: r.jobId } : {}),
  };
}

export function trackUploadStarted(r: JobRecord): void {
  track('upload_started', { size_bytes: r.sizeBytes, transport: r.transport }, ctx(r, false));
}

export function trackUploadCompleted(r: JobRecord, durationMs: number): void {
  track(
    'upload_completed',
    { size_bytes: r.sizeBytes, duration_ms: durationMs, transport: r.transport },
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
    'upload_failed',
    {
      reason,
      status,
      size_bytes: r.sizeBytes,
      duration_ms: durationMs,
      transport: r.transport,
    },
    ctx(r, false),
  );
}

export function trackJobStarted(r: JobRecord): void {
  const target = r.options.format;
  track(
    'job_started',
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
    'job_completed',
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
    'job_failed',
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
    'activation_first_job_completed',
    {
      tool_slug: r.analyticsSlug,
      media_kind: catalogKind(r.mediaKind),
      hours_since_signup: signupAtMs === null ? null : hoursSinceSignupBucket(now - signupAtMs),
      guest: false,
    },
    ctx(r),
  );
}
