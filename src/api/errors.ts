/**
 * One error shape for every API failure. Screens switch on `code`, never on English.
 * Spec: ticket MA03 decisions 8-9, ARCHITECTURE §4.
 */

export const CLIENT_ERROR_CODES = [
  'network',
  'timeout',
  'rate_limited',
  'unauthenticated',
  'not_found',
  'bad_request',
  'forbidden',
  'conflict',
  'server_error',
  'payload_too_large',
  'source_limit_exceeded',
  'contract_mismatch',
  'interrupted',
  'file_gone',
  'unknown',
] as const;

/** snake_case `error` codes present in media_manipulator_api internal/ + cmd/ on 2026-11-01 (MA08 main f4d1d80); `photo_*` added by MA50 (API main 2f341a2, handlers/photo*.go). */
export const API_ERROR_CODES = [
  'account_not_synced',
  'already_on_plan',
  'already_subscribed',
  'billing_provider_error',
  'billing_store_error',
  'billing_unavailable',
  'change_not_available',
  'confirm_required',
  'contact_send_failed',
  'contact_unavailable',
  'currency_locked',
  'export_rate_limited',
  'file_too_large',
  'if_match_invalid',
  'if_match_required',
  'invalid_contact',
  'invalid_currency',
  'invalid_depth',
  'invalid_format',
  'invalid_interval',
  'invalid_offer',
  'invalid_options',
  'invalid_output_language',
  'invalid_plan',
  'invalid_request',
  'invalid_session_id',
  'invalid_signature',
  'language_not_supported',
  'lookup_failed',
  'manual_grant_active',
  'no_audio_or_video',
  'no_billing_account',
  'no_file',
  'no_subscription',
  'not_cancelled',
  'not_ready',
  'not_subscription',
  'nothing_to_keep',
  'offer_changed',
  'offer_not_available',
  'operator_account',
  'output_height_limited',
  'photo_disabled',
  'photo_doc_invalid',
  'photo_doc_too_large',
  'photo_export_invalid',
  'photo_file_too_large',
  'photo_ingest_failed',
  'photo_not_ready',
  'photo_projects_limit',
  'photo_render_unavailable',
  'photo_too_many_pixels',
  'photo_unsupported_source',
  'processing_failed',
  'project_limit_reached',
  'quota_exceeded',
  'reauth_required',
  'result_unavailable',
  'revision_conflict',
  'same_plan',
  'share_limit',
  'share_not_allowed',
  'signin_required',
  'studio_unavailable',
  'summary_not_in_plan',
  'summary_unavailable',
  'thumbnail_content_type',
  'thumbnail_key_invalid',
  'thumbnail_size_required',
  'thumbnail_too_large',
  'unreadable_media',
  'upload_not_found',
  'vector_cap_exceeded',
  'vector_doc_invalid',
  'vector_doc_too_large',
  'vector_export_limit',
  'vector_format_locked',
  'vector_format_not_countable',
  'vector_projects_limit',
  'vectorize_unsupported_file',
] as const;

/** `error` aliases: the API spells the sign-in code both ways. */
const ALIASES: Record<string, MmKnownCode> = { sign_in_required: 'signin_required' };

type MmKnownCode = (typeof CLIENT_ERROR_CODES)[number] | (typeof API_ERROR_CODES)[number];

/** A snake_case code this app version does not know yet passes through as `api:<code>`. */
export type MmErrorCode = MmKnownCode | `api:${string}`;

export type MmErrorStatus = number | 'FETCH_ERROR' | 'PARSE_ERROR';

export interface MmError {
  status: MmErrorStatus;
  code: MmErrorCode;
  /** The API's human string, for logs only; screens never render it raw. */
  message?: string;
  details: Record<string, unknown>;
}

/** 413 `reason` values from validation/ffmpeg.go (source video/audio over plan limits). */
export const SOURCE_LIMIT_REASONS = [
  'video_duration',
  'video_width',
  'video_height',
  'video_pixels',
  'video_fps',
  'audio_duration',
] as const;

const SNAKE = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/;
const KNOWN = new Set<string>([...CLIENT_ERROR_CODES, ...API_ERROR_CODES]);

type HeaderBag = { get(name: string): string | null } | Record<string, string> | undefined;

function readHeader(headers: HeaderBag, name: string): string | null {
  if (!headers) return null;
  if (typeof (headers as { get?: unknown }).get === 'function') {
    return (headers as { get(n: string): string | null }).get(name);
  }
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers as Record<string, string>)) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function isKnownErrorCode(code: string): code is MmKnownCode {
  return KNOWN.has(code);
}

export function networkError(message?: string): MmError {
  return { status: 'FETCH_ERROR', code: 'network', message, details: {} };
}

export function timeoutError(timeoutMs?: number): MmError {
  return { status: 'FETCH_ERROR', code: 'timeout', details: timeoutMs ? { timeoutMs } : {} };
}

export function contractMismatch(endpoint: string, issuePaths: string[]): MmError {
  return {
    status: 'PARSE_ERROR',
    code: 'contract_mismatch',
    details: { endpoint, issues: issuePaths },
  };
}

/** Maps an HTTP failure (status + parsed JSON body, if any) to an MmError. */
export function normaliseError(status: number, body: unknown, headers?: HeaderBag): MmError {
  const obj = isObject(body) ? body : {};
  const errorField = str(obj.error);
  const message = errorField ?? str(obj.message);
  const { error: _error, ...rest } = obj;
  void _error;
  const make = (code: MmErrorCode, details: Record<string, unknown> = rest): MmError => ({
    status,
    code,
    message,
    details,
  });

  // 2. the rate limiter body (internal/limits/limiter.go): human `error` + retryAfterSeconds + scope.
  if (status === 429 && obj.retryAfterSeconds !== undefined && obj.scope !== undefined) {
    const header = Number(readHeader(headers, 'Retry-After'));
    const retryAfterSeconds =
      typeof obj.retryAfterSeconds === 'number'
        ? obj.retryAfterSeconds
        : Number.isFinite(header) && header > 0
          ? header
          : 1;
    return make('rate_limited', { retryAfterSeconds, scope: obj.scope });
  }

  // 2b. DELETE /account answers 502 with the deletion report (no `error` field): keep it whole so the
  // screen can offer Retry (the call is resumable; account_delete.go).
  if (status === 502 && typeof obj.status === 'string' && Array.isArray(obj.steps)) {
    return make('server_error', { report: obj, retryable: obj.retryable !== false });
  }

  // 3. stable snake_case codes from the API (with the sign-in alias).
  if (errorField && SNAKE.test(errorField)) {
    const aliased = ALIASES[errorField] ?? errorField;
    return make(isKnownErrorCode(aliased) ? aliased : (`api:${aliased}` as const));
  }

  // 4. 413: source limits carry a human error + `reason`; otherwise a plain size refusal.
  if (status === 413) {
    const reason = str(obj.reason);
    return reason ? make('source_limit_exceeded', { ...rest, reason }) : make('payload_too_large');
  }

  // 5. status fallbacks.
  if (status === 401) return make('unauthenticated');
  if (status === 404) return make('not_found');
  if (status === 400) return make('bad_request');
  if (status === 403) return make('forbidden');
  if (status === 409) return make('conflict');
  if (status === 429) {
    // 429 without the limiter body: still a rate limit, honour Retry-After.
    const header = Number(readHeader(headers, 'Retry-After'));
    return make('rate_limited', {
      ...rest,
      retryAfterSeconds: Number.isFinite(header) && header > 0 ? header : 1,
    });
  }
  if (status >= 500) return make('server_error');

  return make('unknown');
}

export function isMmError(e: unknown): e is MmError {
  return isObject(e) && typeof e.code === 'string' && isObject(e.details) && 'status' in e;
}
