import type { TiersResponse } from '@/api/schemas/tiers';
import type { TierLimits } from '@/api/schemas/tierLimits';

const base: TierLimits = {
  opsPerDay: 30,
  aiOpsPerDay: 10,
  exportsPerDay: 30,
  maxFileBytes: 1_073_741_824,
  maxVideoSeconds: 1200,
  maxOutputHeight: 1080,
  priorityGpu: false,
  resultRetentionHours: 24,
  adsRemoved: false,
};

/** Shape of GET /api/tiers (values follow the API defaults for free/premium/pro). */
export const TIERS: TiersResponse['tiers'] = [
  { tier: 'anonymous', limits: { ...base, opsPerDay: 5, aiOpsPerDay: 2 } },
  { tier: 'free', limits: base },
  {
    tier: 'premium',
    limits: {
      ...base,
      opsPerDay: 300,
      aiOpsPerDay: 100,
      maxFileBytes: 5_368_709_120,
      maxVideoSeconds: 7200,
      maxOutputHeight: 1440,
      resultRetentionHours: 168,
      adsRemoved: true,
    },
  },
  {
    tier: 'pro',
    limits: {
      ...base,
      opsPerDay: 700,
      aiOpsPerDay: 200,
      maxFileBytes: 5_368_709_120,
      maxVideoSeconds: 7200,
      maxOutputHeight: 2160,
      resultRetentionHours: 720,
      adsRemoved: true,
    },
  },
];

export const FREE_LIMITS = TIERS[1]!.limits;

export const SNAPSHOT = {
  limits: FREE_LIMITS,
  usage: { ops: 24, ai_ops: 1 } as Record<string, number>,
  resetsAt: '2026-11-03T00:00:00Z',
};
