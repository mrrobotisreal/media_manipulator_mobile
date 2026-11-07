import type { ToolOptions } from './types';

/**
 * TS port of the API's QuotaMetricForJob (internal/handlers/quota_metric.go) and the web's
 * quotaMetricForTask (components/quota-chip.tsx). Keep the set identical to aiOpsUploadOperations.
 */
export const AI_OPS_UPLOAD_OPERATIONS: ReadonlySet<string> = new Set([
  'ai_upscale',
  'face_privacy',
  'redact_text',
  'remove_object',
  'isolate_vocals',
  'remove_vocals',
  'frame_interpolation',
]);

/**
 * MA34: Voices jobs and creations. The API charges `ai_ops` for speak, convert, clone and design
 * (`cmd/api/main.go` quota rows) and `ops` for shift; the job record's options carry that `tool`.
 */
const VOICE_AI_OPS_TOOLS: ReadonlySet<string> = new Set([
  'voice_tts',
  'voice_convert',
  'voice_clone',
  'voice_design',
]);

export function quotaMetricForJob(options: ToolOptions): 'ops' | 'ai_ops' {
  if (typeof options.tool === 'string' && VOICE_AI_OPS_TOOLS.has(options.tool)) return 'ai_ops';
  const mode = options.mode;
  if (typeof mode === 'string' && mode.trim().toLowerCase() === 'transcribe') return 'ai_ops';
  const ai = options.ai;
  if (ai && typeof ai === 'object') {
    const { enabled, operation } = ai as { enabled?: unknown; operation?: unknown };
    const op = typeof operation === 'string' ? operation.trim().toLowerCase() : '';
    if (enabled === true && op !== '' && op !== 'none' && AI_OPS_UPLOAD_OPERATIONS.has(op)) {
      return 'ai_ops';
    }
  }
  return 'ops';
}
