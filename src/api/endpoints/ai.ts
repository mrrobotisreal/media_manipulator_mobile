import { buildHeaders as realBuildHeaders, headerBag } from '../baseQuery';
import { API_BASE_URL } from '../config';
import { contractMismatch, networkError, normaliseError, type MmError } from '../errors';
import { faceDetectionResponseSchema, type FaceDetectionResponse } from '../schemas/faces';

export type DetectFacesResult =
  | { ok: true; data: FaceDetectionResponse }
  | { ok: false; error: MmError };

/** The slice of an expo-file-system UploadTask this call uses (jest injects a fake). */
export interface DetectTask {
  uploadAsync(): Promise<{ status: number; headers: Record<string, string>; body: string }>;
  cancel(): void;
}
export interface DetectDeps {
  makeTask(
    uri: string,
    url: string,
    opts: {
      headers: Record<string, string>;
      fieldName: string;
      mimeType: string;
      signal: AbortSignal;
    },
  ): DetectTask;
  buildHeaders?: typeof realBuildHeaders;
  baseUrl?: string;
}

function parseJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `POST /api/ai/faces/detect`: multipart field `file` with the SAME cached file the job will upload (the
 * server binds the session to the bytes' SHA-256). Standard headers (Bearer, session id). Not quota-charged;
 * errors: 400 "only supports image files", 429 rate_limited, 503 AI off.
 */
export async function detectFaces(
  file: { uri: string; mimeType: string },
  deps: DetectDeps,
  signal: AbortSignal = new AbortController().signal,
): Promise<DetectFacesResult> {
  const headersFor = deps.buildHeaders ?? realBuildHeaders;
  const url = `${deps.baseUrl ?? API_BASE_URL}/ai/faces/detect`;
  try {
    const headers = await headersFor({});
    const task = deps.makeTask(file.uri, url, {
      headers,
      fieldName: 'file',
      mimeType: file.mimeType,
      signal,
    });
    const onAbort = () => task.cancel();
    signal.addEventListener('abort', onAbort);
    let res;
    try {
      res = await task.uploadAsync();
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
    const body = parseJson(res.body);
    if (res.status >= 200 && res.status < 300) {
      const parsed = faceDetectionResponseSchema.safeParse(body);
      if (parsed.success) return { ok: true, data: parsed.data };
      const issues = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || '(root)'))];
      return { ok: false, error: contractMismatch('ai/faces/detect', issues) };
    }
    return { ok: false, error: normaliseError(res.status, body, headerBag(res.headers)) };
  } catch (e) {
    return { ok: false, error: networkError(e instanceof Error ? e.message : undefined) };
  }
}

/** Real bindings (expo-file-system multipart task). Required lazily so tests never load it. */
export function realDetectDeps(): DetectDeps {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { File, UploadType } = require('expo-file-system') as typeof import('expo-file-system');
  return {
    makeTask: (uri, url, o) =>
      new File(uri).createUploadTask(url, {
        httpMethod: 'POST',
        uploadType: UploadType.MULTIPART,
        headers: o.headers,
        fieldName: o.fieldName,
        mimeType: o.mimeType,
        sessionType: 'foreground',
        signal: o.signal,
      }),
  };
}
