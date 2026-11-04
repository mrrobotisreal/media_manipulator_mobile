/**
 * Which registry rows the server can run right now (ticket MA50 decision 9; the MA29 capability
 * hook, first user). A row with `capability: 'photo'` is hidden when `GET /photo/capabilities`
 * says `enabled: false` or `render: false`. While the capabilities are loading, or when the call
 * fails, the row is shown (the editor itself says "isn't available right now").
 */
import type { PhotoCapabilities } from '@/api/schemas/photo';
import { useGetPhotoCapabilitiesQuery } from '@/photo/projectsApi';
import type { AnyToolDefinition } from './types';

export interface Capabilities {
  photo?: Pick<PhotoCapabilities, 'enabled' | 'render'>;
}

export function isToolAvailable(
  tool: Pick<AnyToolDefinition, 'capability'>,
  caps: Capabilities,
): boolean {
  if (tool.capability === 'photo') {
    const p = caps.photo;
    return !p || (p.enabled && p.render !== false);
  }
  return true;
}

/** A filter for tool lists (Tools tab, search, intake). */
export function useToolAvailability(): (tool: AnyToolDefinition) => boolean {
  const photo = useGetPhotoCapabilitiesQuery();
  const caps: Capabilities = { photo: photo.data };
  return (tool) => isToolAvailable(tool, caps);
}
