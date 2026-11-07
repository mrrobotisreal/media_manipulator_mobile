/**
 * Voices analytics (ticket MA34 decision 11): the two helpers that build `voice_created` and
 * `voice_generated` props, ports of the web `lib/voices/analytics.ts`. Names come from EVENTS; props are
 * closed vocabularies only. NEVER a voice name, a description, the spoken text or audio.
 */
import { EVENTS } from '@/analytics/events';
import type {
  VoiceCreatedKindProp,
  VoiceCreatedProps,
  VoiceGeneratedKindProp,
  VoiceGeneratedProps,
  VoiceSecondsBucketProp,
  VoiceSourceProp,
} from '@/analytics/events';
import { track } from '@/analytics/track';

/** Web `voiceSecondsBucket` (lib/analytics/buckets.ts): lower bound inclusive. */
export function voiceSecondsBucket(seconds: number): VoiceSecondsBucketProp {
  if (!(seconds >= 10)) return '0-10';
  if (seconds < 30) return '10-30';
  if (seconds < 60) return '30-60';
  if (seconds < 300) return '60-300';
  return '300+';
}

const LANG_RE = /^[a-z]{2}$/;
const lang = (code: string | undefined | null) => (code && LANG_RE.test(code) ? code : 'none');

export function voiceCreatedProps(
  kind: VoiceCreatedKindProp,
  languageHint: string | undefined,
): VoiceCreatedProps {
  return { kind, languageHint: lang(languageHint) === 'none' ? 'en' : (languageHint as string) };
}

/** `voice_created`, once the API answered 201. */
export function trackVoiceCreated(
  kind: VoiceCreatedKindProp,
  languageHint: string | undefined,
  toolSlug: string,
): void {
  track(EVENTS.VOICE_CREATED, voiceCreatedProps(kind, languageHint), {
    tool_slug: toolSlug,
    feature: 'voices',
  });
}

/** The API job tool -> the event's kind. */
export function voiceKindForTool(tool: string): VoiceGeneratedKindProp {
  if (tool === 'voice_convert') return 'convert';
  if (tool === 'voice_shift') return 'shift';
  return 'tts';
}

export function voiceGeneratedProps(input: {
  tool: string;
  resultSeconds: number | undefined;
  language: string | undefined;
  source: VoiceSourceProp;
}): VoiceGeneratedProps {
  const kind = voiceKindForTool(input.tool);
  return {
    kind,
    secondsBucket: voiceSecondsBucket(
      typeof input.resultSeconds === 'number' ? input.resultSeconds : 0,
    ),
    language: kind === 'shift' ? 'none' : lang(input.language),
    source: input.source,
  };
}

/** Jobs already reported this app session: a remount or a re-poll never counts twice. */
const reported = new Set<string>();
export function resetVoiceAnalyticsForTests(): void {
  reported.clear();
}

/** `voice_generated`, exactly once per completed job id. Returns whether it fired. */
export function trackVoiceGenerated(
  jobId: string,
  input: {
    tool: string;
    resultSeconds: number | undefined;
    language: string | undefined;
    source: VoiceSourceProp;
    toolSlug?: string;
  },
): boolean {
  if (!jobId || reported.has(jobId)) return false;
  reported.add(jobId);
  track(EVENTS.VOICE_GENERATED, voiceGeneratedProps(input), {
    job_id: jobId,
    feature: 'voices',
    ...(input.toolSlug ? { tool_slug: input.toolSlug } : {}),
  });
  return true;
}
