/**
 * Which registry rows the server can run right now (ticket MA50 decision 9; the MA29 capability
 * hook, first user). A row with `capability: 'photo'` is hidden when `GET /photo/capabilities`
 * says `enabled: false` or `render: false`. While the capabilities are loading, or when the call
 * fails, the row is shown (the editor itself says "isn't available right now"). `photoHeal` rows
 * (MA52) are also hidden when `heal` is false.
 */
import type { PhotoCapabilities } from '@/api/schemas/photo';
import type { VoicesCapabilities } from '@/api/schemas/voices';
import { useGetPhotoCapabilitiesQuery } from '@/photo/projectsApi';
import { useVoicesCapabilities } from '@/voices/useVoicesCapabilities';
import { isVoiceCapabilityMet } from '@/voices/gating';
import type { AnyToolDefinition } from './types';

export interface Capabilities {
  photo?: Pick<PhotoCapabilities, 'enabled' | 'render'> & { heal?: boolean };
  /**
   * MA34: the voices capabilities. Unlike photo, a Voices row is HIDDEN while this is loading or when the
   * call failed (`undefined`): the rows only appear once the server has answered.
   */
  voices?: Pick<VoicesCapabilities, 'enabled' | 'limits'>;
}

export function isToolAvailable(
  tool: Pick<AnyToolDefinition, 'capability'>,
  caps: Capabilities,
): boolean {
  if (
    tool.capability === 'voiceClone' ||
    tool.capability === 'voiceDesign' ||
    tool.capability === 'voiceChange' ||
    tool.capability === 'voiceShift'
  ) {
    return isVoiceCapabilityMet(tool.capability, caps.voices);
  }
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
  const voices = useVoicesCapabilities();
  const caps: Capabilities = { photo: photo.data, voices: voices.caps };
  return (tool) => isToolAvailable(tool, caps);
}
