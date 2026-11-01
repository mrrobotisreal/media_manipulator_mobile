import type { ResultContext } from '@/analytics/resultEvents';
import { trackShareLinkCopied } from '@/analytics/saveEvents';
import type { CreatedShare } from '@/api/schemas/job';
import type { ResultKind } from './describe';

/** Mirrors web `ShareErrorCode`; the API codes are in `handlers/share.go`. */
export type ShareErrorCode =
  | 'not_allowed' // 422 share_not_allowed
  | 'unavailable' // 409 result_unavailable
  | 'limit' // 409 share_limit (5 live links)
  | 'unauthorized'
  | 'not_found'
  | 'network'
  | 'unknown';

export interface ShareDeps {
  create(jobId: string): Promise<CreatedShare>;
  revoke(jobId: string): Promise<{ revoked?: number }>;
  copy(text: string): Promise<void>;
}

export type ShareOutcome =
  { status: 'copied'; url: string; expiresAt: string } | { status: 'error'; code: ShareErrorCode };

/** Maps an `MmError` (or anything thrown) to the share error vocabulary. */
export function shareErrorCode(e: unknown): ShareErrorCode {
  const err = e as { status?: unknown; code?: unknown } | null;
  const code = typeof err?.code === 'string' ? err.code : '';
  const status = err?.status;
  if (code === 'share_not_allowed' || status === 422) return 'not_allowed';
  if (code === 'result_unavailable') return 'unavailable';
  if (code === 'share_limit') return 'limit';
  if (status === 401 || code === 'unauthenticated') return 'unauthorized';
  if (status === 404) return 'not_found';
  if (code === 'network' || code === 'timeout') return 'network';
  return 'unknown';
}

/**
 * Mints a public link and copies the URL (only the URL: never the file name). Every call mints a new link
 * (the API is not idempotent), so callers guard against double taps. Emits `share_link_copied` on success.
 */
export async function createAndCopyShareLink(
  jobId: string,
  kind: ResultKind,
  context: ResultContext,
  deps: ShareDeps,
): Promise<ShareOutcome> {
  let created: CreatedShare;
  try {
    created = await deps.create(jobId);
  } catch (e) {
    return { status: 'error', code: shareErrorCode(e) };
  }
  try {
    await deps.copy(created.url);
  } catch {
    return { status: 'error', code: 'unknown' };
  }
  trackShareLinkCopied(context, kind);
  return { status: 'copied', url: created.url, expiresAt: created.expiresAt };
}

/** Revokes every live link of the job. `revoked` is how many there were (0 = none). */
export async function revokeAllShareLinks(
  jobId: string,
  deps: Pick<ShareDeps, 'revoke'>,
): Promise<{ status: 'revoked'; count: number } | { status: 'error'; code: ShareErrorCode }> {
  try {
    const r = await deps.revoke(jobId);
    return { status: 'revoked', count: r.revoked ?? 0 };
  } catch (e) {
    return { status: 'error', code: shareErrorCode(e) };
  }
}
