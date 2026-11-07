/**
 * The three voices job starters (ticket MA34 decisions 7-8), on the MA50 starter seam in `jobEngine.ts`:
 *
 *  - `voiceSpeak`   `POST /voices/:id/speak` | `/voices/presets/:preset/speak` (JSON) -> 202 `{jobId}`
 *  - `voiceConvert` `POST /voices/convert` (multipart `input`, `voiceId` | `preset`, `language?`)
 *  - `voiceShift`   `POST /voices/shift` (multipart `input`, `semitones`, `formant`, `preset?`)
 *
 * From the 202 on, MA12 tracks the job, MA13 shows the result and MA14 saves it, unchanged. The request
 * rides in the record's `options` (`VoiceJobOptions`) so a retry, also after a relaunch, re-sends it.
 * Convert and shift upload a file inside `start`, so the starter emits the `upload_*` funnel events
 * itself (the engine does not for starter jobs). The text, the voice id and file names never go to analytics.
 */
import type { ThunkDispatch, UnknownAction } from '@reduxjs/toolkit';
import { postVoicesMultipart, realMultipartDeps, type MultipartDeps } from '@/api/endpoints/voices';
import type { MmError } from '@/api/errors';
import { voiceJobStartSchema } from '@/api/schemas/voices';
import * as events from '@/analytics/jobEvents';
import type { JobStarter } from '@/jobs/jobEngine';
import type { Failure } from '@/jobs/transport';
import type { JobRecord } from '@/jobs/types';
import type { VoiceSourceProp } from '@/analytics/events';

export const VOICE_SPEAK_STARTER = 'voiceSpeak';
export const VOICE_CONVERT_STARTER = 'voiceConvert';
export const VOICE_SHIFT_STARTER = 'voiceShift';

/** What the record's `options` carry (never sent to analytics). Type aliases: assignable to ToolOptions. */
export type VoiceSpeakOptions = {
  tool: 'voice_tts';
  /** Exactly one of voiceId / preset. */
  voiceId?: string;
  preset?: string;
  text: string;
  language: string;
  exaggeration?: number;
  source: VoiceSourceProp;
};
export type VoiceConvertOptions = {
  tool: 'voice_convert';
  voiceId?: string;
  preset?: string;
  language?: string;
  source: VoiceSourceProp;
};
export type VoiceShiftOptions = {
  tool: 'voice_shift';
  semitones: number;
  formant: 'preserved' | 'shifted';
  preset?: string;
  source: VoiceSourceProp;
};
export type VoiceJobOptions = VoiceSpeakOptions | VoiceConvertOptions | VoiceShiftOptions;

export const isVoiceJobOptions = (o: unknown): o is VoiceJobOptions =>
  !!o &&
  typeof o === 'object' &&
  ['voice_tts', 'voice_convert', 'voice_shift'].includes((o as { tool?: string }).tool ?? '');

const FIELD = 'input';

function failure(error: MmError): Failure {
  const rejected =
    typeof error.status === 'number' &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408;
  return {
    ok: false,
    kind: rejected ? 'rejected' : 'failed',
    error,
    reason: error.status === 'FETCH_ERROR' ? 'network' : error.code,
    status: typeof error.status === 'number' ? error.status : undefined,
  };
}

const cancelled = (): Failure => ({
  ok: false,
  kind: 'cancelled',
  error: { status: 'FETCH_ERROR', code: 'network', details: {} },
  reason: 'cancelled',
});

export type SpeakCall = (
  o: VoiceSpeakOptions,
) => Promise<{ ok: true; jobId: string } | { ok: false; error: MmError }>;

/** Speak: the RTK Query mutations on the real store. */
export function rtkSpeakCall(dispatch: ThunkDispatch<unknown, unknown, UnknownAction>): SpeakCall {
  return async (o) => {
    // Lazy: keeps the API slice out of pure imports of this module.
    const { voicesApi } = await import('@/api/endpoints/voices');
    const r = o.voiceId
      ? await dispatch(
          voicesApi.endpoints.speakVoice.initiate({
            voiceId: o.voiceId,
            body: { text: o.text, language: o.language, exaggeration: o.exaggeration },
          }),
        )
      : await dispatch(
          voicesApi.endpoints.speakPreset.initiate({
            preset: o.preset ?? '',
            body: { text: o.text, language: o.language },
          }),
        );
    if ('error' in r && r.error) return { ok: false, error: r.error as MmError };
    return { ok: true, jobId: (r as { data: { jobId: string } }).data.jobId };
  };
}

export function makeVoiceSpeakStarter(
  call: SpeakCall,
  hooks: { settled?: (record: JobRecord) => void } = {},
): JobStarter {
  return {
    async start(record, signal) {
      const o = record.options;
      if (!isVoiceJobOptions(o) || o.tool !== 'voice_tts') {
        return failure({
          status: 'PARSE_ERROR',
          code: 'contract_mismatch',
          details: { starter: VOICE_SPEAK_STARTER },
        });
      }
      if (signal.aborted) return cancelled();
      const r = await call(o);
      return r.ok ? { ok: true, jobId: r.jobId } : failure(r.error);
    },
    settled: hooks.settled,
  };
}

/** The multipart parameters of a convert / shift (everything but the `input` file part). */
export function voiceMultipart(o: VoiceConvertOptions | VoiceShiftOptions): {
  path: string;
  parameters: Record<string, string>;
} {
  if (o.tool === 'voice_convert') {
    return {
      path: '/convert',
      parameters: {
        ...(o.voiceId ? { voiceId: o.voiceId } : {}),
        ...(!o.voiceId && o.preset ? { preset: o.preset } : {}),
        ...(o.language ? { language: o.language } : {}),
      },
    };
  }
  return {
    path: '/shift',
    parameters: {
      semitones: String(o.semitones),
      formant: o.formant,
      ...(o.preset ? { preset: o.preset } : {}),
    },
  };
}

export function makeVoiceUploadStarter(
  tool: 'voice_convert' | 'voice_shift',
  getDeps: () => MultipartDeps,
  hooks: { settled?: (record: JobRecord) => void; now?: () => number } = {},
): JobStarter {
  const now = hooks.now ?? Date.now;
  return {
    async start(record, signal) {
      const o = record.options;
      if (!isVoiceJobOptions(o) || o.tool !== tool) {
        return failure({
          status: 'PARSE_ERROR',
          code: 'contract_mismatch',
          details: { starter: tool },
        });
      }
      if (signal.aborted) return cancelled();
      const t0 = now();
      events.trackUploadStarted(record);
      const { path, parameters } = voiceMultipart(o as VoiceConvertOptions | VoiceShiftOptions);
      const r = await postVoicesMultipart(
        path,
        { uri: record.fileUri, mimeType: record.mimeType, fieldName: FIELD },
        parameters,
        voiceJobStartSchema,
        getDeps(),
        signal,
      );
      if (signal.aborted) return cancelled();
      if (r.ok) {
        events.trackUploadCompleted(record, now() - t0);
        return { ok: true, jobId: r.data.jobId };
      }
      const f = failure(r.error);
      events.trackUploadFailed(record, f.reason, now() - t0, f.status);
      return f;
    },
    settled: hooks.settled,
  };
}

export const makeVoiceConvertStarter = (getDeps: () => MultipartDeps = realMultipartDeps) =>
  makeVoiceUploadStarter('voice_convert', getDeps);
export const makeVoiceShiftStarter = (getDeps: () => MultipartDeps = realMultipartDeps) =>
  makeVoiceUploadStarter('voice_shift', getDeps);
