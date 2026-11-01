import { accountApi } from '@/api/endpoints/account';
import type { TierLimits } from '@/api/schemas/tierLimits';
import { useAppSelector } from '@/state/hooks';

/** The full cached `/account/me` limits (cache read only), or undefined while it has not loaded. */
export function useAccountLimitsFull(): TierLimits | undefined {
  return useAppSelector(
    (s) => accountApi.endpoints.getAccountMe.select()(s as never)?.data?.limits,
  );
}
