import type { MmError } from '@/api/errors';

/**
 * Every error code the voices routes write (`voiceErr` in `media_manipulator_api/internal/handlers/voices.go`),
 * plus the two the shared middleware writes on these routes. Mirrors `VOICE_ERROR_CODES` in the web
 * `lib/voices/voicesApi.ts`; each one has a synced copy in `interface:voiceTools.errors.<code>`.
 */
export const VOICE_ERROR_CODES = [
  'sign_in_required',
  'consent_required',
  'reference_required',
  'reference_too_short',
  'reference_too_long',
  'reference_too_large',
  'no_speech_detected',
  'not_audio',
  'name_invalid',
  'language_not_supported',
  'voice_limit',
  'text_required',
  'text_too_long',
  'exaggeration_invalid',
  'voice_convert_not_in_plan',
  'voice_input_too_long',
  'input_required',
  'input_too_large',
  'voice_required',
  'voice_not_found',
  'preset_not_found',
  'description_required',
  'description_too_long',
  'preview_limit',
  'session_required',
  'semitones_invalid',
  'shift_invalid',
  'voices_unavailable',
  'voices_storage_unavailable',
  'voices_timeout',
  'voice_request_refused',
  'upload_failed',
  'job_failed',
  'invalid_body',
  // The route limiter's 429 (voices_create, voices_design_preview) carries prose, not a code.
  'rate_limited',
  'generic',
] as const;

export type VoiceErrorCode = (typeof VOICE_ERROR_CODES)[number];

const KNOWN = new Set<string>(VOICE_ERROR_CODES);

/**
 * `MmError` (MA03) -> the code the UI translates. The API's snake_case `error` arrives as
 * `api:<code>` (or the known code, `signin_required` for the sign-in alias); unknown ones fall back by status.
 */
export function voiceErrorCode(error: Pick<MmError, 'status' | 'code'>): VoiceErrorCode {
  const raw = error.code.startsWith('api:') ? error.code.slice(4) : error.code;
  const code = raw === 'signin_required' ? 'sign_in_required' : raw;
  if (KNOWN.has(code)) return code as VoiceErrorCode;
  if (error.status === 429) return 'rate_limited';
  if (error.status === 401) return 'sign_in_required';
  if (error.status === 503) return 'voices_unavailable';
  return 'generic';
}

/** The i18n key (`interface` namespace) of an error's copy. */
export function voiceErrorKey(code: VoiceErrorCode): string {
  return `interface:voiceTools.errors.${code}`;
}

/** The interpolation values an error message may use ({{limit}}, {{seconds}}, ...), from the body. */
export function voiceErrorValues(error: Pick<MmError, 'details'>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const k of ['limit', 'used', 'seconds', 'retryAfterSeconds', 'maxSeconds', 'minSeconds']) {
    const v = error.details[k];
    if (typeof v === 'number' || typeof v === 'string') out[k] = v;
  }
  // voice_input_too_long speaks of {{limit}}; reference_too_long of the 60 s ceiling.
  return out;
}

/** Full copy for an error, through the caller's `t`. */
export function voiceErrorText(
  t: (key: string, values?: Record<string, string | number>) => string,
  error: MmError,
): string {
  return t(voiceErrorKey(voiceErrorCode(error)), voiceErrorValues(error));
}
