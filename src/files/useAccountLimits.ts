import { accountApi } from '@/api/endpoints/account';
import { useAppSelector } from '@/state/hooks';
import type { PreflightLimits } from './preflight';

/**
 * Limits from the cached `/account/me` snapshot, or undefined while it has not loaded. Reads the cache
 * only (no fetch): pre-flight skips size/duration while unknown, never guesses.
 */
export function useAccountLimits(): PreflightLimits | undefined {
  const limits = useAppSelector(
    (s) => accountApi.endpoints.getAccountMe.select()(s as never)?.data?.limits,
  );
  return limits
    ? { maxFileBytes: limits.maxFileBytes, maxVideoSeconds: limits.maxVideoSeconds }
    : undefined;
}
