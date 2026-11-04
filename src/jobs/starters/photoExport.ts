/**
 * The `photoExport` job starter (ticket MA50 decision 8, on the MA50 starter seam in
 * `jobEngine.ts`): `POST /photo/projects/:id/export` with the doc → 202 `{jobId}`; from there MA12
 * tracks the job, MA13 shows the result and MA14 saves it, unchanged. The request rides in the
 * job record's `options` (`photoExportOptions`) so a retry, also after a relaunch, re-sends it.
 */
import type { ThunkDispatch, UnknownAction } from '@reduxjs/toolkit';
import type { MmError } from '@/api/errors';
import type { PhotoExportRequest } from '@/api/schemas/photo';
import type { JobRecord } from '@/jobs/types';
import type { Failure } from '@/jobs/transport';
import type { JobStarter } from '@/jobs/jobEngine';

export const PHOTO_EXPORT_STARTER = 'photoExport';

/** What the record's `options` carry for an export (never sent to analytics). A type alias, not an
 * interface, so it is assignable to the engine's `ToolOptions` record. */
export type PhotoExportOptions = {
  tool: 'photo_export';
  projectId: string;
  /** If-Match for the doc saved with the export; omitted = the project's current revision. */
  revision?: number;
  body: PhotoExportRequest;
  /** For the analytics props of the outcome (buckets are computed at the edges). */
  megapixels: number;
};

export function photoExportOptions(o: Omit<PhotoExportOptions, 'tool'>): PhotoExportOptions {
  return { tool: 'photo_export', ...o };
}

export const isPhotoExportOptions = (o: unknown): o is PhotoExportOptions =>
  !!o && typeof o === 'object' && (o as PhotoExportOptions).tool === 'photo_export';

export type ExportCall = (args: {
  id: string;
  revision?: number;
  body: PhotoExportRequest;
}) => Promise<{ ok: true; jobId: string } | { ok: false; error: MmError }>;

function failure(error: MmError): Failure {
  const rejected =
    typeof error.status === 'number' &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408;
  return {
    ok: false,
    kind: rejected ? 'rejected' : 'failed',
    error,
    reason: error.status === 'FETCH_ERROR' ? 'network' : error.code,
    status: typeof error.status === 'number' ? error.status : undefined,
  };
}

export function makePhotoExportStarter(
  call: ExportCall,
  hooks: { settled?: (record: JobRecord) => void } = {},
): JobStarter {
  return {
    async start(record, signal) {
      const o = record.options;
      if (!isPhotoExportOptions(o)) {
        return failure({
          status: 'PARSE_ERROR',
          code: 'contract_mismatch',
          details: { starter: PHOTO_EXPORT_STARTER },
        });
      }
      if (signal.aborted) {
        return {
          ok: false,
          kind: 'cancelled',
          error: { status: 'FETCH_ERROR', code: 'network', details: {} },
          reason: 'cancelled',
        };
      }
      const r = await call({ id: o.projectId, revision: o.revision, body: o.body });
      return r.ok ? { ok: true, jobId: r.jobId } : failure(r.error);
    },
    settled: hooks.settled,
  };
}

/** The app's call: the RTK Query mutation on the real store. */
export function rtkExportCall(
  dispatch: ThunkDispatch<unknown, unknown, UnknownAction>,
): ExportCall {
  return async (args) => {
    // Lazy: keep the API slice out of pure imports of this module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { photoApi } = require('@/photo/projectsApi') as typeof import('@/photo/projectsApi');
    const r = await dispatch(photoApi.endpoints.exportPhotoProject.initiate(args));
    if ('error' in r && r.error) return { ok: false, error: r.error as MmError };
    return { ok: true, jobId: (r as { data: { jobId: string } }).data.jobId };
  };
}
