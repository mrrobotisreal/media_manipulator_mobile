import type { JobRecord } from '@/jobs/types';
import { isVoiceJobOptions } from '@/jobs/starters/voices';
import { trackVoiceGenerated } from './analytics';

const SLUG_BY_TOOL = {
  voice_tts: 'voice-cloning',
  voice_convert: 'voice-changer',
  voice_shift: 'voice-changer',
} as const;

/**
 * The `settled` hook of the voices starters: `voice_generated` once per completed job (ticket MA34
 * decision 11), with the requested language (`none` for shift and for convert to a saved voice), the
 * `resultSeconds` bucket and the `source` the job started from. Once per job id, so a re-poll, a restore or
 * a remount never counts twice. Failed and rejected jobs emit nothing here (`job_failed` covers them).
 */
export function trackVoiceGeneratedFor(record: JobRecord): void {
  if (record.state !== 'completed' || !record.jobId) return;
  const o = record.options;
  if (!isVoiceJobOptions(o)) return;
  const language =
    o.tool === 'voice_tts'
      ? o.language
      : o.tool === 'voice_convert' && !o.voiceId
        ? o.language
        : undefined;
  trackVoiceGenerated(record.jobId, {
    tool: o.tool,
    resultSeconds: record.job?.resultSeconds,
    language,
    source: o.source,
    toolSlug: SLUG_BY_TOOL[o.tool],
  });
}
