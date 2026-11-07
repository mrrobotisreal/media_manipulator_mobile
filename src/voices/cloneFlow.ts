import { referenceLengthVerdict, VOICE_NAME_MAX_CHARS } from '@/tools/voices/consent';

export interface CloneInputs {
  hasFile: boolean;
  durationSec?: number;
  name: string;
  consent: boolean;
  /** `used >= limit` with a positive limit (-1 = unlimited, 0 = the plan saves none). */
  atLimit: boolean;
  busy: boolean;
}

export type CloneBlock =
  'no_file' | 'too_short' | 'too_long' | 'no_name' | 'no_consent' | 'at_limit' | 'busy';

/**
 * Why Create voice is disabled (null = enabled). A file with an unknown duration (a probe that timed out)
 * is allowed: the server checks 5 to 60 s itself (`reference_too_short` / `reference_too_long`).
 */
export function cloneBlockReason(i: CloneInputs): CloneBlock | null {
  if (i.busy) return 'busy';
  if (!i.hasFile) return 'no_file';
  if (i.durationSec !== undefined) {
    const v = referenceLengthVerdict(i.durationSec);
    if (v !== 'ok') return v;
  }
  const name = i.name.trim();
  if (name.length === 0 || [...name].length > VOICE_NAME_MAX_CHARS) return 'no_name';
  if (i.atLimit) return 'at_limit';
  if (!i.consent) return 'no_consent';
  return null;
}

/** `used >= limit`; limit -1 is unlimited and 0 means the plan cannot save voices. */
export const atVoiceLimit = (used: number, limit: number): boolean => limit !== -1 && used >= limit;
