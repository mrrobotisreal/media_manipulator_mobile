import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from '@/state/store';

export { useGetAccountUsageQuery, useSyncAccountMutation } from './endpoints/account';
export { useAccountMeQuery as useGetAccountMeQuery } from './useAccountMe';
export { useGetTiersQuery } from './endpoints/tiers';

/** Quota state for one metric (`ops | ai_ops | export | vector_export`), or undefined. */
export const selectQuotaFor = (metric: string) =>
  createSelector(
    (s: RootState) => s.quota.metrics[metric],
    (m) => m,
  );
