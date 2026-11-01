import { API_BASE_URL } from '@/api/config';
import type { HistoryEntry } from '@/api/schemas/history';

/** A presigned `downloadUrl` lives 15 min; stop trusting it after 10. */
export const PRESIGNED_TRUST_MS = 10 * 60 * 1000;

interface Cached {
  entry: HistoryEntry;
  at: number;
}

const cache = new Map<string, Cached>();

/** In-memory only (decision 6): the History tab stores the row it opens so the result screen can fall back to it. */
export function rememberEntry(entry: HistoryEntry, now: number = Date.now()): void {
  cache.set(entry.jobId, { entry, at: now });
}

export function recallEntry(jobId: string | undefined): HistoryEntry | undefined {
  return jobId ? cache.get(jobId)?.entry : undefined;
}

export function forgetEntry(jobId: string): void {
  cache.delete(jobId);
}

export function clearEntryCache(): void {
  cache.clear();
}

function originOf(base: string = API_BASE_URL): string {
  try {
    return new URL(base).origin;
  } catch {
    return base.replace(/\/api\/?$/, '');
  }
}

export type DirectSource = 'downloadAbsoluteUrl' | 'downloadUrl' | 'downloadPath';

export interface DirectDownload {
  url: string;
  source: DirectSource;
  /** True when the host is the API (needs the owner headers); false for a presigned S3 URL. */
  ownerHeaders: boolean;
}

/**
 * Where the bytes come from, in order: `downloadAbsoluteUrl` (MA08) > `downloadUrl` (presigned, absolute) >
 * API origin + `downloadPath`. `null` means mint a link (`POST /download/:id/link`). A presigned URL older
 * than {@link PRESIGNED_TRUST_MS} is never used.
 */
export function directDownloadFor(
  entry: HistoryEntry,
  ageMs = 0,
  origin: string = originOf(),
): DirectDownload | null {
  if (entry.expired || entry.status !== 'completed') return null;
  if (entry.downloadAbsoluteUrl)
    return { url: entry.downloadAbsoluteUrl, source: 'downloadAbsoluteUrl', ownerHeaders: true };
  if (entry.downloadUrl && ageMs < PRESIGNED_TRUST_MS)
    return { url: entry.downloadUrl, source: 'downloadUrl', ownerHeaders: false };
  if (entry.downloadPath) {
    const rel = entry.downloadPath.startsWith('/') ? entry.downloadPath : `/${entry.downloadPath}`;
    return { url: `${origin}/api${rel}`, source: 'downloadPath', ownerHeaders: true };
  }
  return null;
}

/** The direct download for a remembered entry, or null. */
export function directDownloadForJob(
  jobId: string,
  now: number = Date.now(),
): DirectDownload | null {
  const hit = cache.get(jobId);
  return hit ? directDownloadFor(hit.entry, now - hit.at) : null;
}
