import type { BaseQueryFn } from '@reduxjs/toolkit/query';
import type { ZodTypeAny } from 'zod';
import { track } from '@/analytics/track';
import { uuidv4 } from '@/lib/ids';
import { getRequestLocale } from '@/lib/locale';
import { userAgent } from '@/lib/userAgent';
import { observed } from '@/state/slices/quota';
import { sessionExpired } from '@/state/slices/auth';
import { API_BASE_URL, JSON_TIMEOUT_MS } from './config';
import { getIdToken } from './authToken';
import {
  contractMismatch,
  networkError,
  normaliseError,
  timeoutError,
  type MmError,
} from './errors';
import { getAppState } from './stateRef';

export interface BuildHeadersOptions {
  /** Attach the Bearer token when one is available (default true). */
  auth?: boolean;
  /** Force a Firebase token refresh (used for the 401 retry). */
  forceRefresh?: boolean;
}

/**
 * Headers every API call carries: Bearer (if signed in), session/visitor ids, a fresh
 * request id, the app User-Agent, Accept-Language and Accept. Also used by uploads, SSE
 * and downloads (MA12/MA14) so nothing falls back to RN's `okhttp` UA.
 */
export async function buildHeaders(
  opts: BuildHeadersOptions = {},
): Promise<Record<string, string>> {
  const state = getAppState();
  const headers: Record<string, string> = {
    'X-MM-Request-ID': uuidv4(),
    'User-Agent': userAgent(),
    'Accept-Language': state ? getRequestLocale(state) : 'en-US',
    Accept: 'application/json',
  };
  if (state) {
    headers['X-MM-Session-ID'] = state.session.sessionId;
    headers['X-MM-Visitor-ID'] = state.session.visitorId;
  }
  if (opts.auth !== false) {
    const token = await getIdToken(opts.forceRefresh ?? false);
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export interface MmRequest {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** JSON-serialised when an object. */
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  /** Default `JSON_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Send the Bearer token (default true). */
  auth?: boolean;
  /** Skip the `Account` invalidation on non-2xx (set by the endpoints that provide `Account`). */
  skipAccountInvalidation?: boolean;
  /** Zod schema for a 2xx body; a failure becomes `contract_mismatch` (never a crash). */
  schema?: ZodTypeAny;
}

export interface MmMeta {
  status?: number;
  headers?: Headers;
}

let invalidateAccount: (() => { type: string; payload?: unknown }) | null = null;

/** mmApi.ts registers `mmApi.util.invalidateTags(['Account'])`; avoids a module cycle. */
export function registerAccountInvalidator(fn: () => { type: string; payload?: unknown }): void {
  invalidateAccount = fn;
}

function buildUrl(req: MmRequest): string {
  const path = req.url.startsWith('/') ? req.url : `/${req.url}`;
  let url = `${API_BASE_URL}${path}`;
  if (req.params) {
    const qs = Object.entries(req.params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    if (qs) url += `${url.includes('?') ? '&' : '?'}${qs}`;
  }
  return url;
}

type Attempt =
  | { kind: 'response'; status: number; headers: Headers; body: unknown }
  | { kind: 'error'; error: MmError };

async function attempt(
  req: MmRequest,
  forceRefresh: boolean,
  outerSignal?: AbortSignal,
): Promise<Attempt> {
  const timeoutMs = req.timeoutMs ?? JSON_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onOuterAbort = () => controller.abort();
  outerSignal?.addEventListener('abort', onOuterAbort);
  try {
    const headers = await buildHeaders({ auth: req.auth, forceRefresh });
    const hasBody = req.body !== undefined && req.body !== null;
    if (hasBody) headers['Content-Type'] = 'application/json';
    const res = await fetch(buildUrl(req), {
      method: req.method ?? 'GET',
      headers: { ...headers, ...req.headers },
      body: hasBody ? JSON.stringify(req.body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let body: unknown = undefined;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = undefined;
      }
    }
    return { kind: 'response', status: res.status, headers: res.headers, body };
  } catch (e) {
    if (timedOut) return { kind: 'error', error: timeoutError(timeoutMs) };
    if (outerSignal?.aborted) return { kind: 'error', error: networkError('aborted') };
    return { kind: 'error', error: networkError(e instanceof Error ? e.message : undefined) };
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener('abort', onOuterAbort);
  }
}

/** Anything with a case-insensitive `get` (fetch `Headers`, or `headerBag()` over a plain record). */
export interface HeaderReader {
  get(name: string): string | null;
}

/** Wraps a plain header record (expo-file-system upload results) as a case-insensitive reader. */
export function headerBag(record: Record<string, string>): HeaderReader {
  const lower = new Map(Object.entries(record).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name) => lower.get(name.toLowerCase()) ?? null };
}

export function parseQuota(headers: HeaderReader) {
  const tier = headers.get('X-MM-Tier') ?? undefined;
  const limitRaw = headers.get('X-MM-Quota-Limit');
  const remainingRaw = headers.get('X-MM-Quota-Remaining');
  const limit = limitRaw !== null ? Number(limitRaw) : undefined;
  const remaining = remainingRaw !== null ? Number(remainingRaw) : undefined;
  const hasCounts =
    limit !== undefined &&
    remaining !== undefined &&
    Number.isFinite(limit) &&
    Number.isFinite(remaining);
  if (!tier && !hasCounts) return null;
  return {
    tier,
    // Absent metric header with limit/remaining present means `ops` (pre-MM90 behaviour).
    metric: hasCounts ? (headers.get('X-MM-Quota-Metric') ?? 'ops') : undefined,
    limit: hasCounts ? limit : undefined,
    remaining: hasCounts ? remaining : undefined,
    resetAt: headers.get('X-MM-Quota-Reset'),
  };
}

/**
 * The one RTK Query baseQuery. Adds identity headers, retries a 401 once with a forced
 * token refresh (a second 401 dispatches `auth/sessionExpired`), feeds quota headers to
 * the `quota` slice on 2xx, invalidates `Account` on other failures (the API refunds
 * non-2xx charges) and normalises every error to an `MmError`.
 */
export const mmBaseQuery: BaseQueryFn<
  string | MmRequest,
  unknown,
  MmError,
  object,
  MmMeta
> = async (args, api) => {
  const req: MmRequest = typeof args === 'string' ? { url: args } : args;
  let result = await attempt(req, false, api.signal);

  if (
    result.kind === 'response' &&
    result.status === 401 &&
    req.auth !== false &&
    !isReauthRequired(result.body)
  ) {
    result = await attempt(req, true, api.signal);
    if (result.kind === 'response' && result.status === 401 && !isReauthRequired(result.body)) {
      api.dispatch(sessionExpired());
    }
  }

  if (result.kind === 'error') return { error: result.error };

  const { status, headers, body } = result;
  const meta: MmMeta = { status, headers };

  if (status >= 200 && status < 300) {
    const q = parseQuota(headers);
    if (q) api.dispatch(observed(q));
    if (req.schema) {
      const parsed = req.schema.safeParse(body);
      if (!parsed.success) {
        const issues = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || '(root)'))];
        track('client_error', {
          message: 'contract_mismatch',
          stage: api.endpoint,
          error_type: 'contract_mismatch',
          source: 'manual',
        });
        return { error: contractMismatch(api.endpoint, issues), meta };
      }
      return { data: parsed.data, meta };
    }
    return { data: body ?? null, meta };
  }

  if (status !== 401 && !req.skipAccountInvalidation && invalidateAccount) {
    api.dispatch(invalidateAccount());
  }
  return { error: normaliseError(status, body, headers), meta };
};

function isReauthRequired(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { error?: unknown }).error === 'reauth_required'
  );
}
