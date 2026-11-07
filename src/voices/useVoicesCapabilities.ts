import type { VoicesCapabilities } from '@/api/schemas/voices';
import { useGetVoicesCapabilitiesQuery } from '@/api/endpoints/voices';

/**
 * `GET /voices/capabilities` for the signed-in caller. The server answers `Cache-Control: private,
 * max-age=10`, so a mount or app foreground older than 10 s refetches; screens that regain focus call
 * `refetch` (Tools tab). `caps` is undefined while loading and when the call failed (the rows stay hidden).
 */
export function useVoicesCapabilities(): {
  caps: VoicesCapabilities | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} {
  const q = useGetVoicesCapabilitiesQuery(undefined, {
    refetchOnMountOrArgChange: 10,
    refetchOnFocus: true,
    refetchOnReconnect: true,
  });
  return {
    caps: q.isError ? undefined : q.data,
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: () => void q.refetch(),
  };
}
