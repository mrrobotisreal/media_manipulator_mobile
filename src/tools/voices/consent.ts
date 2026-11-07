/**
 * Voices constants shared by every screen (ticket MA34 decisions 3-6). IMPORT-FREE on purpose.
 *
 * VOICE_CONSENT_TEXT_VERSION names the consent sentence the clone screen shows. Change it ONLY together
 * with: the web constant (`media-manipulator-ui/lib/voices/consent.ts`), the server's
 * `VOICES_CONSENT_TEXT_VERSION` (`media_manipulator_api/internal/config/voices.go`, default `2026-10-28`)
 * and the Terms of Service section 8.11 in every locale. The consent sentence itself is the synced web
 * string `interface:voiceTools.consent.label`; it is legal text, never paraphrase it.
 */
export const VOICE_CONSENT_TEXT_VERSION = '2026-10-28';

/** Reference clip bounds, inclusive (`voices.go` voiceReferenceMinSeconds / voiceReferenceMaxSeconds). */
export const VOICE_REFERENCE_MIN_SECONDS = 5;
export const VOICE_REFERENCE_MAX_SECONDS = 60;

/** Saved-voice name length (`validVoiceName`). */
export const VOICE_NAME_MAX_CHARS = 60;
/** Design description cap (`voiceDescriptionMaxChars`). */
export const VOICE_DESCRIPTION_MAX_CHARS = 1000;
/** Design previews per description per hour (`VOICES_DESIGN_PREVIEWS_PER_HOUR`). */
export const VOICE_DESIGN_PREVIEWS_PER_DESCRIPTION = 3;

/** Exaggeration bounds and default (`voiceExaggerationMin` / `Max`; Chatterbox default 0.5). */
export const VOICE_EXAGGERATION_MIN = 0.25;
export const VOICE_EXAGGERATION_MAX = 2;
export const VOICE_EXAGGERATION_DEFAULT = 0.5;
export const VOICE_EXAGGERATION_STEP = 0.05;

export type ReferenceLengthVerdict = 'ok' | 'too_short' | 'too_long';

/** The recorder / upload length gate: 5 to 60 s inclusive, like the server (web `referenceLengthVerdict`). */
export function referenceLengthVerdict(seconds: number): ReferenceLengthVerdict {
  if (!Number.isFinite(seconds) || seconds < VOICE_REFERENCE_MIN_SECONDS) return 'too_short';
  if (seconds > VOICE_REFERENCE_MAX_SECONDS) return 'too_long';
  return 'ok';
}
