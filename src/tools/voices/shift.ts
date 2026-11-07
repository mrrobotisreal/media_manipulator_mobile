/**
 * Shifter presets, mirrored from `media_manipulator_api/internal/services/voices_shift.go`
 * `VoiceShiftPresets` and the web `lib/voices/shift.ts`. The server's table wins: the app shows
 * `capabilities.shiftPresets` when it has them and falls back to this table. Import-free.
 */
export type Formant = 'preserved' | 'shifted';

export interface ShiftPreset {
  id: string;
  semitones: number;
  formant: Formant;
}

export const VOICE_SHIFT_PRESETS: readonly ShiftPreset[] = [
  { id: 'deeper', semitones: -4, formant: 'shifted' },
  { id: 'higher', semitones: 4, formant: 'shifted' },
  { id: 'child', semitones: 7, formant: 'shifted' },
  { id: 'elder', semitones: -2, formant: 'preserved' },
  { id: 'telephone', semitones: 0, formant: 'preserved' },
];

/** `services.VoiceShiftMaxSemitones`. */
export const VOICE_SHIFT_MAX_SEMITONES = 12;

/** Clamp like `ResolveVoiceShift`; NaN becomes 0. */
export function clampSemitones(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-VOICE_SHIFT_MAX_SEMITONES, Math.min(VOICE_SHIFT_MAX_SEMITONES, value));
}
