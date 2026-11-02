import { buildHeaders } from '../baseQuery';
import { API_BASE_URL } from '../config';
import { contractMismatch, networkError, normaliseError, type MmError } from '../errors';
import { mmApi } from '../mmApi';
import { diffResultSchema, type DiffResult } from '@/metadata/diffResult';
import { metadataDocumentSchema, type MetadataDocument } from '@/metadata/types';
import type { MakeUploadTask } from '@/jobs/transport';

export type MetadataSide = 'original' | 'result';

/** `GET /job/:id/metadata?side=` and `GET /job/:id/metadata/diff` (handlers/job_metadata*.go). */
export const metadataApi = mmApi.injectEndpoints({
  endpoints: (build) => ({
    getJobMetadata: build.query<MetadataDocument, { jobId: string; side: MetadataSide }>({
      query: ({ jobId, side }) => ({
        url: `/job/${encodeURIComponent(jobId)}/metadata`,
        params: { side },
        schema: metadataDocumentSchema,
        skipAccountInvalidation: true,
      }),
      providesTags: (_r, _e, { jobId }) => [{ type: 'Job', id: jobId }],
      keepUnusedDataFor: 60,
    }),
    getJobMetadataDiff: build.query<DiffResult, string>({
      query: (jobId) => ({
        url: `/job/${encodeURIComponent(jobId)}/metadata/diff`,
        schema: diffResultSchema,
        skipAccountInvalidation: true,
      }),
      providesTags: (_r, _e, jobId) => [{ type: 'Job', id: jobId }],
      keepUnusedDataFor: 60,
    }),
  }),
});

export const { useGetJobMetadataQuery, useGetJobMetadataDiffQuery } = metadataApi;

/** Why `GET /job/:id/metadata/diff` answered 409. */
export type DiffUnavailableReason = 'jobNotCompleted' | 'resultMissing' | 'notComparable';

/**
 * The API names a 409 only through its English `error` string (job_metadata_binary.go
 * computeJobDiff); this is the single place that matches it. Candidate for snake_case codes in a
 * future API ticket (MA21 log).
 */
export function diffUnavailableReason(error: unknown): DiffUnavailableReason | undefined {
  const e = error as Partial<MmError> | undefined;
  if (!e || e.status !== 409) return undefined;
  switch ((e.message ?? '').trim().toLowerCase()) {
    case 'job not completed':
      return 'jobNotCompleted';
    case 'result file not available':
      return 'resultMissing';
    case 'result has no comparable metadata':
      return 'notComparable';
    default:
      // Any other 409 still means "no comparison"; the least specific reason.
      return 'notComparable';
  }
}

export interface InspectDeps {
  makeTask: MakeUploadTask;
  buildHeaders?: typeof buildHeaders;
  baseUrl?: string;
}

export interface InspectSource {
  fileUri: string;
  mimeType: string;
}

export type InspectOutcome =
  { ok: true; document: MetadataDocument } | { ok: false; error: MmError };

/**
 * `POST /metadata/inspect`: multipart field `file`, synchronous, never quota-charged. One retry with
 * a refreshed token on 401. A 400 (`no file provided` / oversized) is a `bad_request` error.
 */
export async function inspectFile(
  src: InspectSource,
  deps: InspectDeps,
  signal: AbortSignal = new AbortController().signal,
  onProgress: (fraction: number) => void = () => undefined,
): Promise<InspectOutcome> {
  const headersFor = deps.buildHeaders ?? buildHeaders;
  const base = deps.baseUrl ?? API_BASE_URL;
  const once = async (forceRefresh: boolean) => {
    const headers = await headersFor({ forceRefresh });
    const task = deps.makeTask(src.fileUri, `${base}/metadata/inspect`, {
      method: 'POST',
      multipart: true,
      headers,
      fieldName: 'file',
      mimeType: src.mimeType,
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
  try {
    let res = await once(false);
    if (res.status === 401) res = await once(true);
    let body: unknown;
    try {
      body = res.body ? JSON.parse(res.body) : undefined;
    } catch {
      body = undefined;
    }
    if (res.status >= 200 && res.status < 300) {
      const parsed = metadataDocumentSchema.safeParse(body);
      if (parsed.success) return { ok: true, document: parsed.data };
      const issues = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || '(root)'))];
      return { ok: false, error: contractMismatch('metadataInspect', issues) };
    }
    return { ok: false, error: normaliseError(res.status, body, res.headers) };
  } catch (e) {
    return { ok: false, error: networkError(e instanceof Error ? e.message : undefined) };
  }
}
