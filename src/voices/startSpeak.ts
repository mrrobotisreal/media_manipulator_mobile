import { getJobEngine } from '@/jobs/runtime';
import { VOICE_SPEAK_STARTER, type VoiceSpeakOptions } from '@/jobs/starters/voices';
import { getTool } from '@/tools/registry';
import { textJobSource } from './sample';

/**
 * Starts a speak job (`POST /voices/:id/speak` or `/voices/presets/:preset/speak`) through the job engine's
 * `voiceSpeak` starter and returns the local job id (the caller opens `/(app)/job/<id>`). `toolId` names the
 * registry row the job belongs to (the screen it started from; History maps `voice_tts` to the cloning row).
 */
export function startSpeakJob(
  options: Omit<VoiceSpeakOptions, 'tool'>,
  toolId: 'voice-clone' | 'voice-design' = 'voice-clone',
): string | undefined {
  const tool = getTool(toolId);
  if (!tool) return undefined;
  const ids = getJobEngine().startJobs([
    {
      tool,
      file: textJobSource(),
      options: { tool: 'voice_tts', ...options },
      starter: VOICE_SPEAK_STARTER,
    },
  ]);
  return ids[0];
}
