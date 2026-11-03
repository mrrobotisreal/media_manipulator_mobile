import { EVENTS } from '@/analytics/events';
import type { AccountDeleteReport } from '@/api/schemas/accountSettings';

/** Policy version stamped on consent records: the legal pages' "Last Updated" date (web `legalCommon.lastUpdated`). */
export const LEGAL_POLICY_VERSION = '2026-10-28';
export const CONSENT_BANNER_VERSION = 'app-1';

/** Body of `POST {ANALYTICS}/v1/consent` (internal/handlers/consent.go; values accepted by normalizeMechanism/Action). */
export function consentRecord(visitorId: string, optedOut: boolean, now: Date = new Date()) {
  return {
    visitor_id: visitorId,
    occurred_at: now.toISOString(),
    mechanism: 'preferences',
    action: optedOut ? 'withdrawn' : 'granted',
    analytics: !optedOut,
    banner_version: CONSENT_BANNER_VERSION,
    policy_version: LEGAL_POLICY_VERSION,
  } as const;
}

type Fetch = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number }>;

export interface OptOutDeps {
  setOptOut(optedOut: boolean): void;
  visitorId(): string;
  fetch: Fetch;
  analyticsBaseUrl: string;
  now?: () => Date;
}

/**
 * Opt-out switch: sets `settings.analyticsOptOut` (MA07 stops capture and clears the outbox; past data
 * is NOT deleted) and records the choice. The consent record is fire-and-forget and never blocks or
 * fails the toggle. Opt-out is not "forget" (design §2): the two are separate paths.
 */
export function setAnalyticsOptOut(optedOut: boolean, deps: OptOutDeps): void {
  deps.setOptOut(optedOut);
  try {
    void deps
      .fetch(`${deps.analyticsBaseUrl}/v1/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(consentRecord(deps.visitorId(), optedOut, deps.now?.())),
      })
      .catch(() => undefined);
  } catch {
    // never blocks the toggle
  }
}

export interface DsrDeps {
  fetch: Fetch;
  analyticsBaseUrl: string;
  /** Firebase ID token of the signed-in user (person scope), or null. */
  idToken(): Promise<string | null>;
  visitorId(): string;
  /** Drops queued events and stops the flush timers (nothing queued may reach the old identity). */
  discardQueued(): void;
  /** `analytics.reset()`: clears `person_hint` and the Crashlytics user. */
  resetAnalytics(): void;
  rotateVisitor(): void;
}

/**
 * "Delete my analytics data": `POST /v1/dsr/delete` with `Authorization: Bearer <ID token>` (person
 * scope: every linked visitor) and `{visitor_id}`. Only on 2xx: discard queued events, reset analytics
 * and rotate `visitorId` so the erasure sticks. Opt-out is untouched. A failure rotates nothing.
 */
export async function deleteAnalyticsData(deps: DsrDeps): Promise<boolean> {
  try {
    const token = await deps.idToken();
    const res = await deps.fetch(`${deps.analyticsBaseUrl}/v1/dsr/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ visitor_id: deps.visitorId() }),
    });
    if (!res.ok) return false;
  } catch {
    return false;
  }
  deps.discardQueued();
  deps.resetAnalytics();
  deps.rotateVisitor();
  return true;
}

export interface DeleteFilesDeps {
  deleteAll(): Promise<{ pending: number }>;
  track(name: typeof EVENTS.DATA_DELETED, props: { scope: 'all'; kind: 'all_files' }): void;
  /** Deletes the cached result/original copies and drops finished job records. */
  wipeLocal(): void;
}

export type DeleteFilesOutcome = 'deleted' | 'pending' | 'failed';

/**
 * "Delete all my files": the typed confirmation happened in the sheet. `data_deleted {all, all_files}`
 * fires only after the API accepted; the local result cache and finished job records go with it.
 */
export async function deleteAllFiles(deps: DeleteFilesDeps): Promise<DeleteFilesOutcome> {
  let pending = 0;
  try {
    ({ pending } = await deps.deleteAll());
  } catch {
    return 'failed';
  }
  deps.track(EVENTS.DATA_DELETED, { scope: 'all', kind: 'all_files' });
  try {
    deps.wipeLocal();
  } catch {
    // the server side is done; a stale cache copy is swept by its TTL
  }
  return pending > 0 ? 'pending' : 'deleted';
}

export type { AccountDeleteReport };
