import type { VoiceCapability } from '@/tools/types';
import type { VoicesCapabilities } from '@/api/schemas/voices';

/**
 * Which Voices tools show (ticket MA34 decision 1; `GET /voices/capabilities`, `voices.go` Capabilities):
 *
 *  - every row is hidden until the call has succeeded (loading or failed: `caps` undefined);
 *  - `voiceShift` (the rubberband shifter) needs neither the voice service nor a GPU, so it shows whenever
 *    the call succeeded, also with `enabled:false`;
 *  - `voiceClone` / `voiceDesign` need `enabled` and `limits.voicesSaved !== 0` (the anonymous row is 0;
 *    -1 is unlimited);
 *  - `voiceChange` needs `enabled` and `limits.voicesConvert`.
 */
export function isVoiceCapabilityMet(
  capability: VoiceCapability,
  caps: Pick<VoicesCapabilities, 'enabled' | 'limits'> | undefined,
): boolean {
  if (!caps) return false;
  switch (capability) {
    case 'voiceShift':
      return true;
    case 'voiceClone':
    case 'voiceDesign':
      return caps.enabled && caps.limits.voicesSaved !== 0;
    case 'voiceChange':
      return caps.enabled && caps.limits.voicesConvert;
  }
}
