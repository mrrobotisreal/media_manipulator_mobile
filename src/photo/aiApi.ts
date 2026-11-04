/**
 * Aperture's AI routes on the phone (ticket MA51 decisions 3 and 5; the API is the source of truth:
 * `media_manipulator_api/internal/handlers/photo_render.go`, MM96 deviations in design §13):
 *
 * - `POST /photo/projects/:id/masks/subject` `{base?}` → 200 `{maskId, maskRef, url, width, height}`
 *   (sync, a few seconds; one `ops`, refunded on a cache hit). The mask PNG is then fetched from
 *   `GET /photo/projects/:id/files/<maskRef>` into the app cache.
 * - `POST /photo/projects/:id/heal` multipart `mask` (PNG at the CURRENT base's size, white = heal)
 *   + `base` (the current base hash, '' = the original) → 202 `{jobId, baseHash, maskRef}`; the
 *   `photo_heal` job's `GET /job/:id` carries `healResult {baseHash, baseRef, proxyRef, maskRef,
 *   width, height}`. One `ai_ops`, refunded on failure.
 *
 * Pure orchestration over injected I/O (tests use a fake fetch); `realAiDeps()` wires the app.
 */
import { buildHeaders, headerBag, parseQuota } from '@/api/baseQuery';
import { API_BASE_URL } from '@/api/config';
import { networkError, normaliseError, type MmError } from '@/api/errors';

const enc = encodeURIComponent;

export interface AiDeps {
  baseUrl: string;
  headers: (o: { forceRefresh: boolean }) => Promise<Record<string, string>>;
  fetch: (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: unknown },
  ) => Promise<{
    status: number;
    headers: Record<string, string>;
    text(): Promise<string>;
  }>;
  /** Multipart upload of a local file (the heal mask). */
  upload: (
    url: string,
    fileUri: string,
    o: {
      fieldName: string;
      mimeType: string;
      parameters: Record<string, string>;
      headers: Record<string, string>;
    },
  ) => Promise<{ status: number; headers: Record<string, string>; body: string }>;
  /** Download an owner-only project file to `dest` (a local path); resolves its uri. */
  download: (url: string, dest: string, headers: Record<string, string>) => Promise<string>;
  onQuota?: (q: NonNullable<ReturnType<typeof parseQuota>>) => void;
  sleep?: (ms: number) => Promise<void>;
}

export type AiResult<T> = { ok: true; value: T } | { ok: false; error: MmError };

const parse = (text: string): unknown => {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
};
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

async function call(
  deps: AiDeps,
  url: string,
  method: string,
  body?: unknown,
): Promise<AiResult<Record<string, unknown>>> {
  const once = async (forceRefresh: boolean) => {
    const headers = await deps.headers({ forceRefresh });
    const h = body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' };
    return deps.fetch(url, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };
  let res;
  try {
    res = await once(false);
    if (res.status === 401) res = await once(true);
  } catch (e) {
    return { ok: false, error: networkError(e instanceof Error ? e.message : undefined) };
  }
  const text = await res.text().catch(() => '');
  const json = parse(text);
  const q = parseQuota(headerBag(res.headers));
  if (q) deps.onQuota?.(q);
  if (res.status >= 200 && res.status < 300)
    return {
      ok: true,
      value: (json && typeof json === 'object' ? json : {}) as Record<string, unknown>,
    };
  return { ok: false, error: normaliseError(res.status, json, headerBag(res.headers)) };
}

export interface SubjectMask {
  maskId: string;
  maskRef: string;
  width: number;
  height: number;
}

/** Ask for the subject mask of the project's current base (`baseHash` '' / undefined = original). */
export async function requestSubjectMask(
  deps: AiDeps,
  projectId: string,
  baseHash?: string,
): Promise<AiResult<SubjectMask>> {
  const r = await call(
    deps,
    `${deps.baseUrl}/photo/projects/${enc(projectId)}/masks/subject`,
    'POST',
    baseHash ? { base: baseHash } : {},
  );
  if (!r.ok) return r;
  const maskRef = str(r.value.maskRef);
  if (!/^masks\/[A-Za-z0-9_-]{1,40}\.png$/.test(maskRef))
    return {
      ok: false,
      error: {
        status: 'PARSE_ERROR',
        code: 'contract_mismatch',
        details: { endpoint: 'subjectMask' },
      },
    };
  return {
    ok: true,
    value: {
      maskId: str(r.value.maskId),
      maskRef,
      width: num(r.value.width),
      height: num(r.value.height),
    },
  };
}

/** `GET /photo/projects/:id/files/<rel>` (masks/<id>.png, bases/<hash>.proxy.jpg) to `dest`. */
export async function fetchProjectFile(
  deps: AiDeps,
  projectId: string,
  rel: string,
  dest: string,
): Promise<string> {
  const headers = await deps.headers({ forceRefresh: false });
  return deps.download(
    `${deps.baseUrl}/photo/projects/${enc(projectId)}/files/${rel}`,
    dest,
    headers,
  );
}

export interface HealOutcome {
  baseHash: string;
  baseRef: string;
  proxyRef: string;
  maskRef?: string;
  width: number;
  height: number;
}

/** Start the heal: the mask PNG (a local file) at the current base's size. */
export async function startHeal(
  deps: AiDeps,
  projectId: string,
  maskUri: string,
  baseHash: string | undefined,
): Promise<AiResult<string>> {
  const url = `${deps.baseUrl}/photo/projects/${enc(projectId)}/heal`;
  const once = async (forceRefresh: boolean) =>
    deps.upload(url, maskUri, {
      fieldName: 'mask',
      mimeType: 'image/png',
      parameters: { base: baseHash ?? '' },
      headers: await deps.headers({ forceRefresh }),
    });
  let res;
  try {
    res = await once(false);
    if (res.status === 401) res = await once(true);
  } catch (e) {
    return { ok: false, error: networkError(e instanceof Error ? e.message : undefined) };
  }
  const json = parse(res.body);
  const q = parseQuota(headerBag(res.headers));
  if (q) deps.onQuota?.(q);
  if (res.status < 200 || res.status >= 300)
    return { ok: false, error: normaliseError(res.status, json, headerBag(res.headers)) };
  const jobId = str((json as Record<string, unknown> | undefined)?.jobId);
  if (!jobId)
    return {
      ok: false,
      error: { status: 'PARSE_ERROR', code: 'contract_mismatch', details: { endpoint: 'heal' } },
    };
  return { ok: true, value: jobId };
}

/** The job's `healResult` (the API field), normalised. */
export function healOutcomeOf(job: Record<string, unknown>): HealOutcome | null {
  const p = job.healResult;
  if (!p || typeof p !== 'object') return null;
  const r = p as Record<string, unknown>;
  const baseHash = str(r.baseHash);
  const baseRef = str(r.baseRef) || (baseHash ? `bases/${baseHash}.png` : '');
  if (!baseHash || !/^bases\/[A-Za-z0-9_-]{1,64}\.png$/.test(baseRef)) return null;
  return {
    baseHash,
    baseRef,
    proxyRef: str(r.proxyRef) || `bases/${baseHash}.proxy.jpg`,
    maskRef: str(r.maskRef) || undefined,
    width: num(r.width),
    height: num(r.height),
  };
}

export type HealStatus =
  | { state: 'running'; progress: number }
  | { state: 'failed'; error: MmError }
  | { state: 'done'; outcome: HealOutcome };

export async function checkHeal(deps: AiDeps, jobId: string): Promise<HealStatus> {
  const r = await call(deps, `${deps.baseUrl}/job/${enc(jobId)}`, 'GET');
  if (!r.ok) return { state: 'failed', error: r.error };
  const j = r.value;
  if (j.status === 'failed')
    return {
      state: 'failed',
      error: { status: 500, code: 'api:photo_heal_failed', details: { message: str(j.error) } },
    };
  if (j.status === 'completed') {
    const outcome = healOutcomeOf(j);
    return outcome
      ? { state: 'done', outcome }
      : {
          state: 'failed',
          error: {
            status: 'PARSE_ERROR',
            code: 'contract_mismatch',
            details: { endpoint: 'heal' },
          },
        };
  }
  return { state: 'running', progress: num(j.progress) };
}

/** Poll the heal job until it settles (1.5 s steps, 10 min cap like the web). */
export async function waitForHeal(
  deps: AiDeps,
  jobId: string,
  opts: { onProgress?: (p: number) => void; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<AiResult<HealOutcome>> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = Date.now() + (opts.timeoutMs ?? 10 * 60_000);
  // Network blips while polling are retried: the job keeps running on the server.
  let misses = 0;
  for (;;) {
    if (opts.signal?.aborted)
      return {
        ok: false,
        error: { status: 'FETCH_ERROR', code: 'network', details: { reason: 'aborted' } },
      };
    const st = await checkHeal(deps, jobId);
    if (st.state === 'done') return { ok: true, value: st.outcome };
    if (st.state === 'failed') {
      if (st.error.status === 'FETCH_ERROR' && misses < 5) misses += 1;
      else return { ok: false, error: st.error };
    } else {
      misses = 0;
      opts.onProgress?.(st.progress);
    }
    if (Date.now() > deadline)
      return { ok: false, error: { status: 504, code: 'api:heal_timeout', details: {} } };
    await sleep(1500);
  }
}

/** The app's wiring: fetch with the one header builder, native multipart upload and download. */
export function realAiDeps(onQuota?: AiDeps['onQuota']): AiDeps {
  // Lazy requires: native modules must not load in pure tests that import this file.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { makeUploadTask } = require('@/jobs/fsTask') as typeof import('@/jobs/fsTask');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { File } = require('expo-file-system') as typeof import('expo-file-system');
  return {
    baseUrl: API_BASE_URL,
    headers: (o) => buildHeaders(o),
    fetch: async (url, init) => {
      const res = await fetch(url, init as RequestInit);
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
      return { status: res.status, headers, text: () => res.text() };
    },
    upload: async (url, fileUri, o) => {
      const task = makeUploadTask(fileUri, url, {
        method: 'POST',
        multipart: true,
        headers: o.headers,
        fieldName: o.fieldName,
        mimeType: o.mimeType,
        parameters: o.parameters,
        sessionType: 'foreground',
        onProgress: () => undefined,
        signal: new AbortController().signal,
      });
      const r = await task.uploadAsync();
      return { status: r.status, headers: r.headers, body: r.body };
    },
    download: async (url, dest, headers) => {
      const f = new File(dest);
      if (f.exists) f.delete();
      const out = await File.downloadFileAsync(url, f, { headers, idempotent: true });
      return out.uri;
    },
    onQuota,
  };
}
