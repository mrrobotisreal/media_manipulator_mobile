import { useGetAccountMeQuery } from './endpoints/account';

type Args = Parameters<typeof useGetAccountMeQuery>;

/** `/account/me` with refetch on app focus and reconnect (Account is the only endpoint that does). */
export function useAccountMeQuery(arg: Args[0] = undefined, options: Args[1] = {}) {
  return useGetAccountMeQuery(arg, {
    refetchOnFocus: true,
    refetchOnReconnect: true,
    ...options,
  });
}
