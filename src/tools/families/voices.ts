import { VoiceChangeForm } from '../forms/voices/VoiceChangeForm';
import { VoiceCloneForm } from '../forms/voices/VoiceCloneForm';
import { VoiceDesignForm } from '../forms/voices/VoiceDesignForm';
import { VoiceShiftForm } from '../forms/voices/VoiceShiftForm';
import { VOICE_CONVERT_STARTER, VOICE_SHIFT_STARTER } from '@/jobs/starters/voices';
import * as o from '../options/voices';
import type { AnyToolDefinition, ToolAccepts } from '../types';
import { AUDIO_ACCEPTS, row } from './shared';

/**
 * The four Voices rows (ticket MA34 decision 1). Family `voices` is its own Tools-tab section; each row is
 * hidden until `GET /voices/capabilities` allows it (`capability`, `src/voices/gating.ts`).
 *
 * Order matters for Medi (`src/assistant/links.ts` keys the first row per `analyticsSlug`): the web's
 * `voice-changer` page maps to `voice-change`, the AI converter, before `voice-shift`.
 */

/** Audio files only: a recording, a voice memo. (A video's audio track is accepted by the API, not offered here.) */
const VOICE_ACCEPTS: ToolAccepts = AUDIO_ACCEPTS;

const base = (r: Parameters<typeof row>[0]) => ({
  ...row(r),
  gpu: r.metric === 'ai_ops',
});

export const voiceTools: AnyToolDefinition[] = [
  {
    ...base({
      id: 'voice-clone',
      family: 'voices',
      icon: 'AudioLines',
      accepts: VOICE_ACCEPTS,
      endpoint: 'upload',
      defaults: o.cloneDefaults,
      metric: 'ai_ops',
      analyticsSlug: 'voice-cloning',
      webTask: 'voice_clone',
      resultHint: 'audio',
      keywords: ['voice-cloning', 'clone', 'voice', 'record', 'speech', 'text-to-speech', 'tts'],
    }),
    Form: VoiceCloneForm,
    optionsBuilder: o.buildClone,
    capability: 'voiceClone',
    noRunButton: true,
  },
  {
    ...base({
      id: 'voice-design',
      family: 'voices',
      icon: 'Sparkles',
      accepts: VOICE_ACCEPTS,
      endpoint: 'upload',
      defaults: o.designDefaults,
      metric: 'ai_ops',
      analyticsSlug: 'voice-designer',
      webTask: 'voice_design',
      resultHint: 'audio',
      keywords: ['voice-designer', 'design', 'describe', 'voice', 'create', 'synthetic'],
    }),
    Form: VoiceDesignForm,
    optionsBuilder: o.buildDesign,
    capability: 'voiceDesign',
    noRunButton: true,
    noFileArea: true,
    noIntake: true,
  },
  {
    ...base({
      id: 'voice-change',
      family: 'voices',
      icon: 'Mic2',
      accepts: VOICE_ACCEPTS,
      endpoint: 'upload',
      defaults: o.changeDefaults,
      metric: 'ai_ops',
      analyticsSlug: 'voice-changer',
      webTask: 'voice_convert',
      resultHint: 'audio',
      keywords: ['voice-changer', 'convert', 'change', 'voice', 'sound-like', 'ai'],
    }),
    Form: VoiceChangeForm,
    optionsBuilder: o.buildChange,
    blockReason: o.changeBlockReason,
    capability: 'voiceChange',
    starter: VOICE_CONVERT_STARTER,
    startLabelKey: 'interface:voiceTools.changer.convert',
  },
  {
    ...base({
      id: 'voice-shift',
      family: 'voices',
      icon: 'SlidersHorizontal',
      accepts: VOICE_ACCEPTS,
      endpoint: 'upload',
      defaults: o.shiftDefaults,
      metric: 'ops',
      analyticsSlug: 'voice-changer',
      webTask: 'voice_shift',
      resultHint: 'audio',
      keywords: ['voice-changer', 'pitch', 'shift', 'deeper', 'higher', 'formant', 'voice'],
    }),
    Form: VoiceShiftForm,
    optionsBuilder: o.buildShift,
    capability: 'voiceShift',
    starter: VOICE_SHIFT_STARTER,
    startLabelKey: 'interface:voiceTools.shifter.shift',
  },
];
