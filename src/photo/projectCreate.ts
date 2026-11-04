/**
 * `POST /photo/projects` (multipart `file`, optional `name`, `doc`) with upload progress, through
 * the same native upload task MA12's transport uses (`fsTask.ts`), so the editor can show
 * "Uploading… 42 %" while the user already edits the local decode. The project id arrives in the
 * 201 `{project, doc}`; Save and Export unlock then.
 *
 * Pure orchestration over injected deps (tests fake the task); `realCreateDeps()` wires the app.
 */
import { buildHeaders, headerBag, parseQuota } from '@/api/baseQuery';
import { API_BASE_URL } from '@/api/config';
import { networkError, normaliseError, type MmError } from '@/api/errors';
import { photoProjectResponseSchema, type PhotoProjectResponse } from '@/api/schemas/photo';
import type { MakeUploadTask } from '@/jobs/transport';
import { canonicalPhotoDoc, type PhotoDoc } from './photoTypes';

export interface CreateInput {
  fileUri: string;
  mimeType: string;
  /** Display name for the project (the server falls back to the file stem). */
  name?: string;
  /** The local edits so far: the server sanitizes them and stamps the ingested size. */
  doc?: PhotoDoc;
}

export type CreateOutcome =
  { ok: true; response: PhotoProjectResponse } | { ok: false; error: MmError };

export interface CreateDeps {
  makeTask: MakeUploadTask;
  headers: (o: { forceRefresh: boolean }) => Promise<Record<string, string>>;
  baseUrl: string;
  onQuota?: (q: NonNullable<ReturnType<typeof parseQuota>>) => void;
}

function parseJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

export async function createPhotoProject(
  input: CreateInput,
  deps: CreateDeps,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<CreateOutcome> {
  const parameters: Record<string, string> = {};
  if (input.name) parameters.name = input.name;
  if (input.doc) parameters.doc = canonicalPhotoDoc(input.doc);

  const once = async (forceRefresh: boolean) => {
    const headers = await deps.headers({ forceRefresh });
    const task = deps.makeTask(input.fileUri, `${deps.baseUrl}/photo/projects`, {
      method: 'POST',
      multipart: true,
      headers,
      fieldName: 'file',
      mimeType: input.mimeType,
      parameters,
      // Android has no background session; iOS keeps it foreground too (the editor is open).
      sessionType: 'foreground',
      onProgress: (p) => {
        if (p.totalBytes > 0) onProgress(Math.min(1, p.bytesSent / p.totalBytes));
      },
      signal,
    });
    const onAbort = () => task.cancel();
    signal.addEventListener('abort', onAbort);
    try {
      return await task.uploadAsync();
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  };

  let res;
  try {
    res = await once(false);
    if (res.status === 401) res = await once(true);
  } catch (e) {
    return {
      ok: false,
      error: networkError(signal.aborted ? 'aborted' : e instanceof Error ? e.message : undefined),
    };
  }
  const body = parseJson(res.body);
  if (res.status >= 200 && res.status < 300) {
    const q = parseQuota(headerBag(res.headers));
    if (q) deps.onQuota?.(q);
    const parsed = photoProjectResponseSchema.safeParse(body);
    if (parsed.success) {
      onProgress(1);
      return { ok: true, response: parsed.data };
    }
    return {
      ok: false,
      error: {
        status: 'PARSE_ERROR',
        code: 'contract_mismatch',
        details: { endpoint: 'createPhotoProject' },
      },
    };
  }
  return { ok: false, error: normaliseError(res.status, body, headerBag(res.headers)) };
}

/** The app's wiring (native upload task, the one header builder, the quota slice). */
export function realCreateDeps(onQuota?: CreateDeps['onQuota']): CreateDeps {
  // Lazy require: the native module must not load in pure tests that import this file.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { makeUploadTask } = require('@/jobs/fsTask') as typeof import('@/jobs/fsTask');
  return {
    makeTask: makeUploadTask,
    headers: (o) => buildHeaders(o),
    baseUrl: API_BASE_URL,
    onQuota,
  };
}
