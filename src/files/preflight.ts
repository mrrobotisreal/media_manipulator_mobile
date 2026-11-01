import type { MediaKind, ToolAccepts } from '@/tools/types';
import { PRESIGN_VIDEO_EXTENSIONS } from './mime';
import { MAX_FILES_PER_SELECTION, type PreflightResult, type RejectReason } from './types';

/** The subset of `/account/me` `limits` the checks read. */
export interface PreflightLimits {
  maxFileBytes: number;
  maxVideoSeconds: number;
}

export interface PreflightInput {
  extension: string;
  mimeType: string;
  /** null = unrecognised kind. */
  mediaKind: MediaKind | null;
  sizeBytes: number;
  durationSec?: number;
}

/** `<= 0` (the API's -1 / 0 "unlimited" convention) never blocks. */
const capped = (limit: number | undefined): limit is number =>
  typeof limit === 'number' && Number.isFinite(limit) && limit > 0;

/** Tool-agnostic support: a known kind, and for video an extension the presign route allows. */
export function isSupportedFile(input: PreflightInput): boolean {
  if (!input.mediaKind) return false;
  if (input.mediaKind === 'video') return PRESIGN_VIDEO_EXTENSIONS.includes(input.extension);
  return true;
}

function acceptedByTool(input: PreflightInput, accepts: ToolAccepts): boolean {
  if (!input.mediaKind || !accepts.kinds.includes(input.mediaKind)) return false;
  if (input.mediaKind === 'video' && !PRESIGN_VIDEO_EXTENSIONS.includes(input.extension)) {
    return false;
  }
  return accepts.extensions.includes(input.extension) || accepts.mime.includes(input.mimeType);
}

/**
 * Pure per-file checks, first failure wins: unsupported_type, too_large, too_long, empty.
 * `accepts` omitted = tool-agnostic (intake screen). `limits` undefined = account snapshot still
 * loading: size and duration are skipped, never guessed. A missing duration (probe failed or timed
 * out) never blocks; the server stays the authority.
 */
export function preflightFile(
  input: PreflightInput,
  accepts?: ToolAccepts,
  limits?: PreflightLimits,
): PreflightResult {
  const supported = accepts ? acceptedByTool(input, accepts) : isSupportedFile(input);
  if (!supported) return { ok: false, reason: 'unsupported_type' };
  if (limits && capped(limits.maxFileBytes) && input.sizeBytes > limits.maxFileBytes) {
    return { ok: false, reason: 'too_large', limit: limits.maxFileBytes };
  }
  if (
    limits &&
    capped(limits.maxVideoSeconds) &&
    (input.mediaKind === 'video' || input.mediaKind === 'audio') &&
    input.durationSec !== undefined &&
    input.durationSec > limits.maxVideoSeconds
  ) {
    return { ok: false, reason: 'too_long', limit: limits.maxVideoSeconds };
  }
  if (input.sizeBytes === 0) return { ok: false, reason: 'empty' };
  return { ok: true };
}

/** Selection-level check (more than 10 files). */
export function preflightCount(count: number, max = MAX_FILES_PER_SELECTION): PreflightResult {
  return count > max ? { ok: false, reason: 'too_many', limit: max } : { ok: true };
}

export const REJECT_REASONS: readonly RejectReason[] = [
  'unsupported_type',
  'too_large',
  'too_long',
  'empty',
  'too_many',
];
