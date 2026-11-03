import type { ResultKind } from '@/results/describe';
import { EVENTS } from './events';
import { track, type EventProps } from './track';

/** Catalog vocabulary (analytics `internal/catalog/catalog.go`, MA13 results batch). */
export type ResultSurface = 'tool_page' | 'history';
export type ResultCompareMode = 'wipe' | 'toggle';
export type ResultEntryKind = 'image' | 'video' | 'audio' | 'text' | 'other';
export type PreviewKind = 'image' | 'video' | 'audio' | 'archive' | 'document';

/** Once-per-app-session memory (web `result-analytics.ts` rule), module level. */
const viewed = new Set<string>();
const previewed = new Set<string>();
const compared = new Set<string>();

export function resetResultAnalyticsForTests(): void {
  viewed.clear();
  previewed.clear();
  compared.clear();
}

/** Event context: `tool_slug`/`media_kind` are unknown for a job opened by deep link. */
export interface ResultContext {
  jobId: string;
  toolSlug?: string;
  mediaKind?: 'image' | 'video' | 'audio' | 'document' | 'unknown';
}

const ctx = (c: ResultContext): EventProps => ({
  job_id: c.jobId,
  ...(c.toolSlug ? { tool_slug: c.toolSlug } : {}),
  ...(c.mediaKind ? { media_kind: c.mediaKind } : {}),
});

/** Coarse bucket for an archive entry; never the file name. */
export function entryKindOf(kind: ResultKind): ResultEntryKind {
  switch (kind) {
    case 'image':
    case 'gif':
      return 'image';
    case 'video':
      return 'video';
    case 'audio':
      return 'audio';
    case 'transcript':
    case 'captions':
    case 'metadata':
      return 'text';
    default:
      return 'other';
  }
}

export function previewKindOf(kind: ResultKind): PreviewKind | null {
  switch (kind) {
    case 'image':
    case 'gif':
      return 'image';
    case 'video':
    case 'audio':
    case 'archive':
      return kind;
    case 'pdf':
      return 'document';
    default:
      return null;
  }
}

export function trackResultViewed(
  c: ResultContext,
  kind: ResultKind,
  surface: ResultSurface,
  hasOriginal: boolean,
): void {
  if (viewed.has(c.jobId)) return;
  viewed.add(c.jobId);
  track(
    EVENTS.RESULT_VIEWED,
    { job_id: c.jobId, kind, surface, has_original: hasOriginal },
    ctx(c),
  );
}

/** When a viewer actually rendered bytes (image decoded, video ready, audio loaded, archive listed). */
export function trackResultPreviewed(c: ResultContext, kind: ResultKind): void {
  const previewKind = previewKindOf(kind);
  if (!previewKind || previewed.has(c.jobId)) return;
  previewed.add(c.jobId);
  track(EVENTS.RESULT_PREVIEWED, { job_id: c.jobId, preview_kind: previewKind }, ctx(c));
}

export function trackResultCompare(
  c: ResultContext,
  kind: ResultKind,
  mode: ResultCompareMode,
): void {
  const key = `${c.jobId}:${mode}`;
  if (compared.has(key)) return;
  compared.add(key);
  track(EVENTS.RESULT_COMPARE_USED, { job_id: c.jobId, kind, mode }, ctx(c));
}

export function trackResultArchiveEntry(c: ResultContext, entryKind: ResultKind): void {
  track(
    EVENTS.RESULT_ARCHIVE_ENTRY_OPENED,
    { job_id: c.jobId, entry_kind: entryKindOf(entryKind) },
    ctx(c),
  );
}

/** True once `result_viewed` fired for the job this app session (`viewed_first` on download clicks). */
export const hasViewedResult = (jobId: string): boolean => viewed.has(jobId);
