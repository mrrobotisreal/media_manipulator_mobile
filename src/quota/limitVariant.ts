import type { MmError } from '@/api/errors';

/** Which refusal sheet an `MmError` opens, or null when it has none (decision 8). */
export type LimitVariant =
  | { kind: 'quota'; metric: 'ops' | 'ai_ops'; limit?: number; resetsAt?: string }
  | { kind: 'rate'; seconds: number }
  | { kind: 'height'; requested?: number; limit?: number }
  | { kind: 'size' }
  | { kind: 'long'; reason: string }
  | { kind: 'cap'; reason: string };

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/**
 * MA03 maps 413 to `payload_too_large` (no `reason`, incl. the MaxBytesReader and "Video exceeds
 * maximum upload size" bodies), `file_too_large` (video-summary's snake_case body) and
 * `source_limit_exceeded` + `details.reason` (validation/ffmpeg.go).
 */
export function limitVariantFor(error: MmError | undefined): LimitVariant | null {
  if (!error) return null;
  const d = error.details;
  switch (error.code) {
    case 'quota_exceeded':
      return {
        kind: 'quota',
        metric: d.metric === 'ai_ops' ? 'ai_ops' : 'ops',
        limit: num(d.limit),
        resetsAt: typeof d.resetsAt === 'string' ? d.resetsAt : undefined,
      };
    case 'rate_limited':
      return { kind: 'rate', seconds: Math.max(1, Math.ceil(num(d.retryAfterSeconds) ?? 1)) };
    case 'output_height_limited':
      return { kind: 'height', requested: num(d.requested), limit: num(d.limit) };
    case 'file_too_large':
    case 'payload_too_large':
    case 'photo_file_too_large':
      return { kind: 'size' };
    case 'source_limit_exceeded': {
      const reason = typeof d.reason === 'string' ? d.reason : '';
      return reason === 'video_duration' || reason === 'audio_duration'
        ? { kind: 'long', reason }
        : { kind: 'cap', reason: reason || 'video_pixels' };
    }
    default:
      return null;
  }
}

/** The `scope` of `quota_exceeded_shown` (web: metric for quota, `detail.error` otherwise). */
export function exceededScope(v: LimitVariant): string | null {
  switch (v.kind) {
    case 'quota':
      return v.metric;
    case 'height':
      return 'output_height_limited';
    case 'size':
      return 'file_too_large';
    case 'long':
    case 'cap':
      return v.reason;
    case 'rate':
      return null;
  }
}
