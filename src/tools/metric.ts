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

export function quotaMetricForJob(options: ToolOptions): 'ops' | 'ai_ops' {
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
