import type { ResultKind } from './describe';

/**
 * Which results the API will share (MM32): a port of web `lib/share/shareApi.ts` `SHAREABLE_KINDS` +
 * `isShareable`, mirroring `internal/share` Shareable. Metadata reports and unknown kinds are refused,
 * and so is any Darkroom (`studio*`) or metadata-inspector tool/mode.
 */
const SHAREABLE_KINDS: ReadonlySet<ResultKind> = new Set<ResultKind>([
  'image',
  'gif',
  'video',
  'audio',
  'transcript',
  'captions',
  'pdf',
  'archive',
  'hls',
  'dash',
]);
const METADATA_LABELS = new Set([
  'inspect_metadata',
  'metadata',
  'metadata_inspect',
  'metadata_report',
]);

export function isShareable(
  kind: ResultKind,
  ...toolOrMode: Array<string | null | undefined>
): boolean {
  if (!SHAREABLE_KINDS.has(kind)) return false;
  for (const raw of toolOrMode) {
    const label = (raw ?? '').trim().toLowerCase();
    if (label.startsWith('studio') || METADATA_LABELS.has(label)) return false;
  }
  return true;
}
