import type { ThunkDispatch, UnknownAction } from '@reduxjs/toolkit';
import {
  buildHeaders as realBuildHeaders,
  headerBag,
  parseQuota,
  type HeaderReader,
} from '@/api/baseQuery';
import { API_BASE_URL } from '@/api/config';
import { jobsApi } from '@/api/endpoints/jobs';
import { networkError, normaliseError, type MmError } from '@/api/errors';
import { mmApi } from '@/api/mmApi';
import type { ConversionJob } from '@/api/schemas/job';
import { uploadResponseSchema, type VideoUploadTarget } from '@/api/schemas/upload';
import { observed } from '@/state/slices/quota';
import { createJobEventStream } from './sse';
import type { ToolOptions } from '@/tools/types';

/** What an upload needs from a job record. */
export interface UploadSource {
  fileUri: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  options: ToolOptions;
}

export type Failure = {
  ok: false;
  /** rejected: the API said no (4xx), terminal. failed: network/S3/5xx, retryable. cancelled: aborted. */
  kind: 'rejected' | 'failed' | 'cancelled';
  error: MmError;
  /** `upload_failed.reason` */
  reason: string;
  status?: number;
};
export type UploadOutcome = { ok: true; jobId: string } | Failure;

export interface EventHandlers {
  onSnapshot(job: ConversionJob): void;
  /** Keepalive comments and anything else that proves the stream is alive. */
  onActivity(): void;
  onError(error: MmError): void;
  /** The stream ended without an error. */
  onClose(): void;
}

export interface JobTransport {
  uploadMultipart(
    src: UploadSource,
    onProgress: (fraction: number) => void,
    signal: AbortSignal,
  ): Promise<UploadOutcome>;
  presign(src: UploadSource): Promise<{ ok: true; target: VideoUploadTarget } | Failure>;
  putBinary(
    target: VideoUploadTarget,
    src: UploadSource,
    onProgress: (fraction: number) => void,
    signal: AbortSignal,
  ): Promise<{ ok: true } | Failure>;
  completePresign(target: VideoUploadTarget, src: UploadSource): Promise<UploadOutcome>;
  fetchJob(
    jobId: string,
  ): Promise<{ ok: true; job: ConversionJob } | { ok: false; error: MmError }>;
  openJobEvents(jobId: string, handlers: EventHandlers): { close(): void };
}

/** The slice of an expo-file-system UploadTask the transport uses. */
export interface UploadTaskLike {
  uploadAsync(): Promise<{ status: number; headers: Record<string, string>; body: string }>;
  cancel(): void;
}

export interface MakeTaskOptions {
  method: 'POST' | 'PUT';
  multipart: boolean;
  headers: Record<string, string>;
  fieldName?: string;
  mimeType: string;
  parameters?: Record<string, string>;
  sessionType: 'background' | 'foreground';
  onProgress: (p: { bytesSent: number; totalBytes: number }) => void;
  signal: AbortSignal;
}
export type MakeUploadTask = (uri: string, url: string, opts: MakeTaskOptions) => UploadTaskLike;

export type StreamFetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  headers: HeaderReader;
  body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
}>;

export interface TransportDeps {
  dispatch: ThunkDispatch<unknown, unknown, UnknownAction>;
  makeTask: MakeUploadTask;
  streamFetch: StreamFetch;
  getSessionId: () => string;
  platform: 'ios' | 'android' | string;
  buildHeaders?: typeof realBuildHeaders;
  baseUrl?: string;
}

function classify(error: MmError): 'rejected' | 'failed' {
  return typeof error.status === 'number' &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408
    ? 'rejected'
    : 'failed';
}

function fromError(error: MmError, reason?: string): Failure {
  return {
    ok: false,
    kind: classify(error),
    error,
    reason: reason ?? (error.status === 'FETCH_ERROR' ? 'network' : error.code),
    status: typeof error.status === 'number' ? error.status : undefined,
  };
}

function parseJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

export function createJobTransport(deps: TransportDeps): JobTransport {
  const { dispatch } = deps;
  const headersFor = deps.buildHeaders ?? realBuildHeaders;
  const base = deps.baseUrl ?? API_BASE_URL;
  const sessionType = deps.platform === 'ios' ? 'background' : 'foreground';

  /** Quota headers on 2xx and 429; any other non-2xx refunds server-side, so re-read Account. */
  function noteResult(status: number, headers: Record<string, string>): void {
    if ((status >= 200 && status < 300) || status === 429) {
      const q = parseQuota(headerBag(headers));
      if (q) dispatch(observed(q));
    }
    if (status < 200 || status >= 300) dispatch(mmApi.util.invalidateTags(['Account']));
  }

  async function runTask(
    uri: string,
    url: string,
    opts: Omit<MakeTaskOptions, 'sessionType'>,
  ): Promise<
    { kind: 'response'; status: number; headers: Record<string, string>; body: string } | Failure
  > {
    if (opts.signal.aborted) return cancelledFailure();
    try {
      const task = deps.makeTask(uri, url, { ...opts, sessionType });
      const onAbort = () => task.cancel();
      opts.signal.addEventListener('abort', onAbort);
      try {
        const res = await task.uploadAsync();
        return { kind: 'response', ...res };
      } finally {
        opts.signal.removeEventListener('abort', onAbort);
      }
    } catch (e) {
      if (opts.signal.aborted) return cancelledFailure();
      return fromError(networkError(e instanceof Error ? e.message : undefined));
    }
  }

  function cancelledFailure(): Failure {
    return {
      ok: false,
      kind: 'cancelled',
      error: { status: 'FETCH_ERROR', code: 'network', message: 'cancelled', details: {} },
      reason: 'cancelled',
    };
  }

  async function postOnce(
    src: UploadSource,
    onProgress: (f: number) => void,
    signal: AbortSignal,
    forceRefresh: boolean,
  ) {
    const headers = await headersFor({ forceRefresh });
    // The native layer sets the multipart Content-Type with its boundary.
    return runTask(src.fileUri, `${base}/upload`, {
      method: 'POST',
      multipart: true,
      headers,
      fieldName: 'file',
      mimeType: src.mimeType,
      parameters: { options: JSON.stringify(src.options) },
      onProgress: (p) => {
        if (p.totalBytes > 0) onProgress(Math.min(1, p.bytesSent / p.totalBytes));
      },
      signal,
    });
  }

  return {
    async uploadMultipart(src, onProgress, signal) {
      let res = await postOnce(src, onProgress, signal, false);
      if (res.kind === 'response' && res.status === 401) {
        res = await postOnce(src, onProgress, signal, true);
      }
      if ('ok' in res) return res;
      noteResult(res.status, res.headers);
      if (res.status >= 200 && res.status < 300) {
        const parsed = uploadResponseSchema.safeParse(parseJson(res.body));
        if (parsed.success) return { ok: true, jobId: parsed.data.jobId };
        return fromError(
          { status: 'PARSE_ERROR', code: 'contract_mismatch', details: { endpoint: 'upload' } },
          'contract_mismatch',
        );
      }
      return fromError(normaliseError(res.status, parseJson(res.body), headerBag(res.headers)));
    },

    async presign(src) {
      const r = await dispatch(
        jobsApi.endpoints.presignVideoUpload.initiate({
          fileName: src.fileName,
          contentType: src.mimeType,
          fileSizeBytes: src.sizeBytes,
        }),
      );
      if ('error' in r && r.error) return fromError(r.error as MmError);
      return { ok: true, target: (r as { data: VideoUploadTarget }).data };
    },

    async putBinary(target, src, onProgress, signal) {
      // Straight to S3: no API headers, and the Content-Type must equal the presigned one.
      const res = await runTask(src.fileUri, target.uploadUrl, {
        method: 'PUT',
        multipart: false,
        headers: { 'Content-Type': src.mimeType },
        mimeType: src.mimeType,
        onProgress: (p) => {
          if (p.totalBytes > 0) onProgress(Math.min(1, p.bytesSent / p.totalBytes));
        },
        signal,
      });
      if ('ok' in res) return res;
      if (res.status >= 200 && res.status < 300) return { ok: true };
      const error = normaliseError(res.status, undefined, headerBag(res.headers));
      return { ok: false, kind: 'failed', error, reason: 's3_put', status: res.status };
    },

    async completePresign(target, src) {
      const r = await dispatch(
        jobsApi.endpoints.completeVideoUpload.initiate({
          s3Key: target.s3Key,
          fileName: src.fileName,
          contentType: src.mimeType,
          fileSizeBytes: src.sizeBytes,
          options: src.options,
        }),
      );
      if ('error' in r && r.error) return fromError(r.error as MmError);
      return { ok: true, jobId: (r as { data: { jobId: string } }).data.jobId };
    },

    async fetchJob(jobId) {
      const r = await dispatch(
        jobsApi.endpoints.getJob.initiate(jobId, { subscribe: false, forceRefetch: true }),
      );
      if ('error' in r && r.error) return { ok: false, error: r.error as MmError };
      return { ok: true, job: (r as { data: ConversionJob }).data };
    },

    openJobEvents(jobId, handlers) {
      return createJobEventStream(
        {
          streamFetch: deps.streamFetch,
          buildHeaders: headersFor,
          baseUrl: base,
          getSessionId: deps.getSessionId,
        },
        jobId,
        handlers,
      );
    },
  };
}
