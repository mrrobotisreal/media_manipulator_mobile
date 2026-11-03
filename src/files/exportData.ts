import { Directory, File, Paths } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
import { buildHeaders } from '@/api/baseQuery';
import { API_BASE_URL } from '@/api/config';
import { networkError, normaliseError, type MmError } from '@/api/errors';
import { sanitizeName } from './mime';

export const EXPORT_FALLBACK_NAME = 'mm-data-export.zip';
export const EXPORT_DIR = 'exports';

/** `attachment; filename="x.zip"` -> `x.zip` (web `exportData`'s regex). */
export function exportFileName(disposition: string | null | undefined): string {
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition ?? '');
  const raw = match?.[1]?.trim();
  if (!raw) return EXPORT_FALLBACK_NAME;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // keep raw
  }
  return sanitizeName(decoded, EXPORT_FALLBACK_NAME);
}

export interface ExportDeps {
  fetch: (
    url: string,
    init: { headers: Record<string, string> },
  ) => Promise<{
    ok: boolean;
    status: number;
    headers: { get(name: string): string | null };
    body: ReadableStream<Uint8Array> | null;
    text(): Promise<string>;
  }>;
  buildHeaders: typeof buildHeaders;
  baseUrl: string;
  /** Destination for a given file name (cache dir). */
  fileFor(name: string): File;
}

export function realExportDeps(): ExportDeps {
  return {
    fetch: (url, init) => expoFetch(url, init) as unknown as ReturnType<ExportDeps['fetch']>,
    buildHeaders,
    baseUrl: API_BASE_URL,
    fileFor: (name) => {
      const dir = new Directory(Paths.cache, EXPORT_DIR);
      dir.create({ intermediates: true, idempotent: true });
      return new File(dir, name);
    },
  };
}

export type ExportResult =
  { ok: true; file: File; fileName: string } | { ok: false; error: MmError };

/**
 * `GET /account/data/export` (a streamed zip, 3 per hour per user) into the cache dir. The file name
 * comes from `Content-Disposition`. 429 `export_rate_limited` keeps `retryAfterSeconds` in `details`.
 * Never throws: the caller shows the error.
 */
export async function downloadExport(deps: ExportDeps = realExportDeps()): Promise<ExportResult> {
  try {
    const headers = await deps.buildHeaders();
    headers.Accept = 'application/zip, application/octet-stream';
    const res = await deps.fetch(`${deps.baseUrl}/account/data/export`, { headers });
    if (!res.ok) {
      let body: unknown;
      try {
        body = JSON.parse(await res.text());
      } catch {
        body = undefined;
      }
      return { ok: false, error: normaliseError(res.status, body, res.headers) };
    }
    if (!res.body) return { ok: false, error: networkError('empty_body') };
    const fileName = exportFileName(res.headers.get('Content-Disposition'));
    const file = deps.fileFor(fileName);
    try {
      if (file.exists) file.delete();
    } catch {
      // best effort
    }
    try {
      file.create({ intermediates: true, overwrite: true });
      await res.body.pipeTo(file.writableStream());
    } catch (e) {
      try {
        if (file.exists) file.delete();
      } catch {
        // partial file
      }
      return { ok: false, error: networkError(e instanceof Error ? e.message : undefined) };
    }
    return { ok: true, file, fileName };
  } catch (e) {
    return { ok: false, error: networkError(e instanceof Error ? e.message : undefined) };
  }
}
