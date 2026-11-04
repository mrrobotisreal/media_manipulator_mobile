/**
 * Which registry rows the server can run right now (ticket MA50 decision 9; the MA29 capability
 * hook, first user). A row with `capability: 'photo'` is hidden when `GET /photo/capabilities`
 * says `enabled: false` or `render: false`. While the capabilities are loading, or when the call
 * fails, the row is shown (the editor itself says "isn't available right now"). `photoHeal` rows
 * (MA52) are also hidden when `heal` is false.
 */
import type { PhotoCapabilities } from '@/api/schemas/photo';
import { useGetPhotoCapabilitiesQuery } from '@/photo/projectsApi';
import type { AnyToolDefinition } from './types';

export interface Capabilities {
  photo?: Pick<PhotoCapabilities, 'enabled' | 'render'> & { heal?: boolean };
}

export function isToolAvailable(
  tool: Pick<AnyToolDefinition, 'capability'>,
  caps: Capabilities,
): boolean {
  if (tool.capability === 'photo' || tool.capability === 'photoHeal') {
    const p = caps.photo;
    if (!p) return true;
    if (!p.enabled || p.render === false) return false;
    // MA52: Remove blemishes is hidden when the tier (or the server) has no heal.
    return tool.capability !== 'photoHeal' || p.heal !== false;
  }
  return true;
}

/** A filter for tool lists (Tools tab, search, intake). */
export function useToolAvailability(): (tool: AnyToolDefinition) => boolean {
  const photo = useGetPhotoCapabilitiesQuery();
  const caps: Capabilities = { photo: photo.data };
  return (tool) => isToolAvailable(tool, caps);
}
