import { useEffect, useMemo, useState } from 'react';
import { accountApi } from '@/api/endpoints/account';
import type { UsageResponse } from '@/api/schemas/account';
import { useAccountMeQuery } from '@/api/useAccountMe';
import { useAppSelector } from '@/state/hooks';
import type { QuotaMetricState } from '@/state/slices/quota';
import type { RootState } from '@/state/store';
import type { QuotaMetric } from '@/tools/types';

export const METRICS: readonly QuotaMetric[] = ['ops', 'ai_ops'];

/** One metered allowance: the merge of the `/account/me` snapshot and the newest quota headers. */
export interface Allowance {
  metric: QuotaMetric;
  /** `<= 0` in the API means "no daily limit" (operator); see `unlimited`. */
  limit: number;
  used: number;
  remaining: number;
  unlimited: boolean;
  /** ISO time the allowance resets (UTC midnight), or null when unknown. */
  resetsAt: string | null;
  /** The snapshot's reset time is in the past: its counts are stale, refetch `/account/me`. */
  needsRefetch: boolean;
  source: 'snapshot' | 'headers';
}

export interface AllowanceInput {
  snapshot?: Pick<UsageResponse, 'limits' | 'usage' | 'resetsAt'>;
  /** When the snapshot was fetched (RTK `fulfilledTimeStamp`). */
  fetchedAt?: number;
  headers: Record<string, QuotaMetricState | undefined>;
  now: number;
}

const LIMIT_KEY = { ops: 'opsPerDay', ai_ops: 'aiOpsPerDay' } as const;

const isFuture = (iso: string | null | undefined, now: number) => {
  const at = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(at) && at > now;
};

/**
 * MA16 decision 2 (proposed merge rule): start from the `/account/me` snapshot and overlay the
 * quota-slice entry for the metric when it is newer than the snapshot's fetch time
 * (`used = limit - remaining`). A header entry whose own reset time has passed is ignored; a
 * snapshot whose reset time has passed counts as zero used and raises `needsRefetch`.
 * Returns null while nothing is known.
 */
export function mergeAllowance(metric: QuotaMetric, input: AllowanceInput): Allowance | null {
  const { snapshot, fetchedAt, now } = input;
  const header = input.headers[metric];
  const headerUsable =
    header !== undefined &&
    header.limit > 0 &&
    (header.resetAt === null || isFuture(header.resetAt, now)) &&
    (fetchedAt === undefined || header.observedAt >= fetchedAt);

  if (headerUsable) {
    const used = Math.max(0, header.limit - header.remaining);
    return {
      metric,
      limit: header.limit,
      used,
      remaining: Math.max(0, header.remaining),
      unlimited: false,
      resetsAt: header.resetAt ?? snapshot?.resetsAt ?? null,
      needsRefetch: false,
      source: 'headers',
    };
  }
  if (!snapshot) return null;

  const limit = snapshot.limits[LIMIT_KEY[metric]];
  const unlimited = limit <= 0;
  const expired = !isFuture(snapshot.resetsAt, now);
  const used = expired ? 0 : (snapshot.usage[metric] ?? 0);
  return {
    metric,
    limit,
    used,
    remaining: unlimited ? Infinity : Math.max(0, limit - used),
    unlimited,
    resetsAt: snapshot.resetsAt,
    needsRefetch: expired,
    source: 'snapshot',
  };
}

/** Store-level read for non-React callers (the Start guard). Reads caches only; never fetches. */
export function selectAllowance(
  state: RootState,
  metric: QuotaMetric,
  now: number = Date.now(),
): Allowance | null {
  const q = accountApi.endpoints.getAccountMe.select()(state as never);
  return mergeAllowance(metric, {
    snapshot: q?.data,
    fetchedAt: q?.fulfilledTimeStamp,
    headers: state.quota.metrics,
    now,
  });
}

export interface AllowanceView {
  ops: Allowance | null;
  ai_ops: Allowance | null;
  tier: string | null;
  /** Earliest reset across the metrics, for the one countdown. */
  resetsAt: string | null;
  pending: boolean;
  now: number;
}

const MINUTE = 60_000;

/** The Tools-tab / chip / Plan sheet source: refetches on foreground and when the reset passes. */
export function useAllowance(): AllowanceView {
  const { data, fulfilledTimeStamp, refetch } = useAccountMeQuery();
  const headers = useAppSelector((s) => s.quota.metrics);
  const headerTier = useAppSelector((s) => s.quota.tier);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), MINUTE);
    return () => clearInterval(id);
  }, []);

  const view = useMemo<AllowanceView>(() => {
    const input = { snapshot: data, fetchedAt: fulfilledTimeStamp, headers, now };
    const ops = mergeAllowance('ops', input);
    const ai = mergeAllowance('ai_ops', input);
    return {
      ops,
      ai_ops: ai,
      tier: data?.tier ?? headerTier,
      resetsAt: ops?.resetsAt ?? ai?.resetsAt ?? null,
      pending: ops === null && ai === null,
      now,
    };
  }, [data, fulfilledTimeStamp, headers, headerTier, now]);

  const stale = Boolean(view.ops?.needsRefetch || view.ai_ops?.needsRefetch);
  useEffect(() => {
    if (stale) void refetch();
  }, [stale, refetch]);
  return view;
}
