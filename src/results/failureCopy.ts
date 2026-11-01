import { API_ERROR_CODES, CLIENT_ERROR_CODES } from '@/api/errors';
import type { JobRecord } from '@/jobs/types';

/** i18n keys (namespace `app`) for the failure body. Every value exists in en-US `result.failed.*`. */
export const FAILURE_KEYS = [
  'generic',
  'processing',
  'rejected',
  'quota',
  'tooLarge',
  'unsupported',
  'unreadable',
  'noAudio',
  'network',
  'timeout',
  'rateLimited',
  'auth',
  'interrupted',
  'fileGone',
  'lost',
  'cancelled',
  'stopped',
] as const;
export type FailureKey = (typeof FAILURE_KEYS)[number];

/** `MmError.code` -> failure copy. Anything unlisted (including `api:<unknown>`) is `generic`. */
const BY_CODE: Record<string, FailureKey> = {
  network: 'network',
  timeout: 'timeout',
  rate_limited: 'rateLimited',
  unauthenticated: 'auth',
  signin_required: 'auth',
  reauth_required: 'auth',
  quota_exceeded: 'quota',
  project_limit_reached: 'quota',
  export_rate_limited: 'rateLimited',
  payload_too_large: 'tooLarge',
  file_too_large: 'tooLarge',
  source_limit_exceeded: 'tooLarge',
  output_height_limited: 'tooLarge',
  interrupted: 'interrupted',
  file_gone: 'fileGone',
  processing_failed: 'processing',
  unreadable_media: 'unreadable',
  no_audio_or_video: 'noAudio',
  invalid_format: 'unsupported',
  invalid_options: 'rejected',
  invalid_request: 'rejected',
  bad_request: 'rejected',
  no_file: 'rejected',
  vectorize_unsupported_file: 'unsupported',
};

export function failureKeyForCode(code: string | undefined): FailureKey {
  return (code && BY_CODE[code]) || 'generic';
}

/** Failure copy key for a terminal non-completed record (`result.failed.<key>`). */
export function failureKeyFor(record: Pick<JobRecord, 'state' | 'error'>): FailureKey {
  switch (record.state) {
    case 'failed':
      return 'processing';
    case 'lost':
      return 'lost';
    case 'cancelled':
      return 'cancelled';
    case 'stopped':
      return 'stopped';
    case 'rejected':
      return failureKeyForCode(record.error?.code) === 'generic'
        ? 'rejected'
        : failureKeyForCode(record.error?.code);
    default:
      return failureKeyForCode(record.error?.code);
  }
}

/** Codes the table knows; the test asserts every API/client code resolves to a real key. */
export const ALL_ERROR_CODES: readonly string[] = [...CLIENT_ERROR_CODES, ...API_ERROR_CODES];
