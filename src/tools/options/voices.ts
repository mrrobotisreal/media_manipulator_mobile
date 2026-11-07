import type { VoiceConvertOptions, VoiceShiftOptions } from '@/jobs/starters/voices';
import { VOICE_SHIFT_PRESETS, clampSemitones, type Formant } from '../voices/shift';
import type { ToolContext, ToolOptions } from '../types';

/** Option builders for the four Voices rows (ticket MA34 decisions 1, 5, 6, 8). */

/** voice-clone / voice-design: not jobs (a synchronous 201); the builder only names the quota unit. */
export const cloneDefaults = {};
export const buildClone = (): ToolOptions => ({ tool: 'voice_clone' });
export const designDefaults = {};
export const buildDesign = (): ToolOptions => ({ tool: 'voice_design' });

// --- voice-change (convert) ------------------------------------------------------------------

export type ChangeForm = {
  /** Exactly one of these once a target is picked. */
  voiceId?: string;
  preset?: string;
  /** Presets only: the language to speak with. */
  language?: string;
  /** `limits.voicesConvertMaxSeconds`, copied from the capabilities by the form (0 = unknown). */
  convertMaxSeconds?: number;
};
export const changeDefaults: ChangeForm = {};

export function buildChange(f: ChangeForm): VoiceConvertOptions {
  return {
    tool: 'voice_convert',
    ...(f.voiceId ? { voiceId: f.voiceId } : {}),
    ...(!f.voiceId && f.preset ? { preset: f.preset } : {}),
    ...(!f.voiceId && f.preset && f.language ? { language: f.language } : {}),
    source: 'tool_page',
  };
}

export type ChangeBlock = 'no_target' | 'too_long';

export function changeBlockReason(f: ChangeForm, ctx?: ToolContext): ChangeBlock | null {
  if (!f.voiceId && !f.preset) return 'no_target';
  const d = ctx?.input?.durationSec;
  if (
    f.convertMaxSeconds &&
    f.convertMaxSeconds > 0 &&
    d !== undefined &&
    d > f.convertMaxSeconds
  ) {
    return 'too_long';
  }
  return null;
}

// --- voice-shift -------------------------------------------------------------------------------

export type ShiftForm = {
  semitones: number;
  formant: Formant;
  /** A preset chip id; the server resolves it and it wins over the pair. */
  preset?: string;
};
export const shiftDefaults: ShiftForm = { semitones: 0, formant: 'preserved' };

export function buildShift(f: ShiftForm): VoiceShiftOptions {
  return {
    tool: 'voice_shift',
    semitones: clampSemitones(f.semitones),
    formant: f.formant,
    ...(f.preset ? { preset: f.preset } : {}),
    source: 'tool_page',
  };
}

/** The pair a preset chip promises (the form shows it; the request carries both). */
export function applyShiftPreset(
  f: ShiftForm,
  id: string,
  table: readonly { id: string; semitones: number; formant: Formant }[] = VOICE_SHIFT_PRESETS,
): ShiftForm {
  const p = table.find((x) => x.id === id);
  return p ? { semitones: p.semitones, formant: p.formant, preset: p.id } : f;
}
