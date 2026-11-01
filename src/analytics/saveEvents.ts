import type { ResultKind } from '@/results/describe';
import { hasViewedResult, type ResultContext, type ResultSurface } from './resultEvents';
import { track, type EventProps } from './track';

/** Catalog `MediaKind` vocabulary for `media_saved.media_kind` / `share_link_copied.job_kind`. */
export type CatalogMediaKind = 'image' | 'video' | 'audio' | 'document' | 'unknown';
export type SaveDestination = 'photos' | 'files' | 'share_sheet';

const ctx = (c: ResultContext): EventProps => ({
  job_id: c.jobId,
  ...(c.toolSlug ? { tool_slug: c.toolSlug } : {}),
  ...(c.mediaKind ? { media_kind: c.mediaKind } : {}),
});

/** Port of web `shareJobKind`: the coarse media bucket of a result kind. Never a file name. */
export function catalogKindOfResult(kind: ResultKind): CatalogMediaKind {
  switch (kind) {
    case 'image':
    case 'gif':
      return 'image';
    case 'video':
    case 'hls':
    case 'dash':
      return 'video';
    case 'audio':
      return 'audio';
    case 'pdf':
    case 'transcript':
    case 'captions':
    case 'archive':
    case 'metadata':
    case 'summary':
      return 'document';
    default:
      return 'unknown';
  }
}

export function trackDownloadClicked(c: ResultContext, kind: ResultKind, surface: ResultSurface) {
  track(
    'result_download_clicked',
    { job_id: c.jobId, kind, surface, viewed_first: hasViewedResult(c.jobId) },
    ctx(c),
  );
}

export function trackDownloadStarted(c: ResultContext, outputFormat: string, sizeBytes?: number) {
  track(
    'download_started',
    { job_id: c.jobId, output_format: outputFormat, size_bytes: sizeBytes },
    ctx(c),
  );
}

export function trackDownloadCompleted(
  c: ResultContext,
  outputFormat: string,
  sizeBytes: number,
  durationMs: number,
) {
  track(
    'download_completed',
    {
      job_id: c.jobId,
      output_format: outputFormat,
      size_bytes: sizeBytes,
      duration_ms: durationMs,
    },
    ctx(c),
  );
}

/** `reason` is a closed vocabulary (`gone|network|link|download|timeout|mp3_failed`), never an error message. */
export function trackDownloadFailed(c: ResultContext, reason: string, status?: number) {
  track('download_failed', { job_id: c.jobId, reason, status }, ctx(c));
}

export function trackMediaSaved(c: ResultContext, destination: SaveDestination, kind: ResultKind) {
  track(
    'media_saved',
    { destination, media_kind: catalogKindOfResult(kind) },
    { ...ctx(c), media_kind: catalogKindOfResult(kind) },
  );
}

export function trackShareLinkCopied(c: ResultContext, kind: ResultKind) {
  track(
    'share_link_copied',
    { job_kind: catalogKindOfResult(kind), source: 'result_panel' },
    ctx(c),
  );
}

export function trackItemDeleted(c: ResultContext) {
  track('data_deleted', { scope: 'item', kind: 'result' }, ctx(c));
}
