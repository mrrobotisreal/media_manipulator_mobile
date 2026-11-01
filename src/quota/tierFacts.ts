import type { TiersResponse } from '@/api/schemas/tiers';
import type { TierLimits } from '@/api/schemas/tierLimits';

export type TierFactKey =
  | 'maxFileBytes'
  | 'maxVideoSeconds'
  | 'maxOutputHeight'
  | 'opsPerDay'
  | 'aiOpsPerDay'
  | 'resultRetentionHours';

export type PaidTier = 'premium' | 'pro';

/** A neutral fact about what higher plans allow: "Premium and Pro accept files up to 5 GB." */
export interface TierFact {
  limitKey: TierFactKey;
  /** The lowest set of higher tiers that raise the limit, sharing `value`. */
  tiers: PaidTier[];
  value: number;
}

const RANK: Record<string, number> = { anonymous: 0, free: 1, premium: 2, pro: 3, operator: 4 };
const PAID: readonly PaidTier[] = ['premium', 'pro'];

/** The API's `-1` ("unlimited") sorts above every number. */
const rank = (n: number) => (n < 0 ? Number.POSITIVE_INFINITY : n);

export function limitsOf(tiers: TiersResponse['tiers'], tier: string): TierLimits | undefined {
  return tiers.find((t) => t.tier === tier)?.limits;
}

/**
 * Pure. What do higher tiers allow for `limitKey`? Null when the current tier is Pro or the
 * operator, when `tiers` lacks the data, or when no higher tier raises the limit (equal limits).
 * When Premium and Pro tie, both are named; otherwise the lowest tier that helps.
 */
export function higherTierFact(
  limitKey: TierFactKey,
  tiers: TiersResponse['tiers'] | undefined,
  currentTier: string | null | undefined,
): TierFact | null {
  if (!tiers || !currentTier) return null;
  const currentRank = RANK[currentTier] ?? RANK.free!;
  if (currentRank >= RANK.pro!) return null;
  const current = limitsOf(tiers, currentTier) ?? limitsOf(tiers, 'free');
  if (!current) return null;
  const base = rank(current[limitKey]);

  const higher = PAID.filter((t) => RANK[t]! > currentRank)
    .map((t) => ({ tier: t, value: limitsOf(tiers, t)?.[limitKey] }))
    .filter((x): x is { tier: PaidTier; value: number } => x.value !== undefined)
    .filter((x) => rank(x.value) > base);
  const first = higher[0];
  if (!first) return null;
  const tied = higher.filter((x) => x.value === first.value).map((x) => x.tier);
  return { limitKey, tiers: tied, value: first.value };
}

const LIMIT_OF_METRIC = { ops: 'opsPerDay', ai_ops: 'aiOpsPerDay' } as const;
export const limitKeyForMetric = (metric: 'ops' | 'ai_ops'): TierFactKey => LIMIT_OF_METRIC[metric];

/** Per-tier values of `limitKey` for the paid tiers above `currentTier` that raise it. */
export function higherTierValues(
  limitKey: TierFactKey,
  tiers: TiersResponse['tiers'] | undefined,
  currentTier: string | null | undefined,
): { tier: PaidTier; value: number }[] {
  if (!tiers || !currentTier) return [];
  const currentRank = RANK[currentTier] ?? RANK.free!;
  const current = limitsOf(tiers, currentTier) ?? limitsOf(tiers, 'free');
  if (!current || currentRank >= RANK.pro!) return [];
  return PAID.filter((t) => RANK[t]! > currentRank)
    .map((t) => ({ tier: t, value: limitsOf(tiers, t)?.[limitKey] }))
    .filter((x): x is { tier: PaidTier; value: number } => x.value !== undefined)
    .filter((x) => rank(x.value) > rank(current[limitKey]));
}
