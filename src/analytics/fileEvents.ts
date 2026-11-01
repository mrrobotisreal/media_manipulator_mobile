import type { MediaKind } from '@/tools/types';
import type { IntakeFile, Rejection } from '@/files/types';
import { track } from './track';

/** Catalog media_kind vocabulary: pdf is `document`. Null = unknown. */
export function catalogKind(
  kind: MediaKind | null,
): 'image' | 'video' | 'audio' | 'document' | undefined {
  if (!kind) return undefined;
  return kind === 'pdf' ? 'document' : kind;
}

const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 100) / 100;

/** Extension only; never the file name (MA-0004). */
const ext = (e: string) => e || 'unknown';

export function trackFileSelected(file: IntakeFile): void {
  track('file_selected', {
    file_extension: ext(file.extension),
    size_bytes: file.sizeBytes,
    file_size_mb: mb(file.sizeBytes),
    media_kind: catalogKind(file.mediaKind),
    // Catalog source vocabulary: picker | share (documents are a picker on mobile).
    source: file.source === 'share' ? 'share' : 'picker',
  });
}

export function trackFileRejected(r: Rejection): void {
  track('file_rejected', {
    reason: r.reason,
    file_extension: r.reason === 'too_many' ? undefined : ext(r.extension),
    size_bytes: r.sizeBytes ?? undefined,
    // limit_bytes is bytes only; the duration and count limits are implied by the reason.
    limit_bytes: r.reason === 'too_large' ? r.limit : undefined,
  });
}

/** `media_kind` = the common kind or 'mixed'. */
export function trackShareIntentReceived(kinds: (MediaKind | null)[]): void {
  const mapped = new Set(kinds.map((k) => catalogKind(k) ?? 'unknown'));
  const kind = mapped.size === 1 ? [...mapped][0] : 'mixed';
  track('share_intent_received', { media_kind: kind, count: kinds.length });
}
