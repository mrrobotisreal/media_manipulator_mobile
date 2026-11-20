/**
 * The `studioExport` job starter (ticket MA58 decision 2, on the MA50 starter seam in
 * `jobEngine.ts`): a Darkroom render of a SAVED project on the server.
 *
 *  - Export:       `POST /studio/projects/:id/export` with the sheet's `StudioExportRequest`
 *  - Export again: `POST /studio/projects/:id/exports/:exportId/again` (the stored options)
 *
 * Both answer 200 `{jobId}`; from there MA12 tracks the `studio_export` job (SSE / poll), MA13
 * shows the result (video, or audio for an audio-only output) and MA14 saves it. A refusal
 * (403 `format_not_in_plan` / `output_height_limited`, 429 export allowance or rate limit) ends
 * the record `rejected` and the job screen opens MA16's sheet. The request rides in the record's
 * `options` so a retry, also after a relaunch, re-sends it.
 *
 * Analytics: `studio_export_started` once the server accepted the render, then
 * `studio_export_completed` / `studio_export_failed` from the settled hook (the web's props,
 * catalog batch "MA58 projects"). Never the file name.
 */
import type { ThunkDispatch, UnknownAction } from '@reduxjs/toolkit';
import type { MmError } from '@/api/errors';
import type { StudioExportRequest } from '@/api/schemas/studio';
import { EVENTS } from '@/analytics/events';
import { track as realTrack } from '@/analytics/track';
import type { JobStarter } from '@/jobs/jobEngine';
import type { Failure } from '@/jobs/transport';
import type { JobRecord } from '@/jobs/types';
import {
  durationRatioBucket,
  type StudioExportProps,
} from '@/studio/mobile/ui/export/exportModel';

export const STUDIO_EXPORT_STARTER = 'studioExport';
/** `context.tool_slug` of every Darkroom event from the phone (design DARKROOM_MOBILE.md §8). */
export const DARKROOM_TOOL_SLUG = 'darkroom';

/** What the record's `options` carry. A type alias, so it is assignable to `ToolOptions`. */
export type StudioExportJobOptions = {
  tool: 'studio_export';
  projectId: string;
  /** A fresh export's body; absent for Export again. */
  body?: StudioExportRequest;
  /** Export again: the stored export row to replay. */
  againExportId?: string;
  /** Timeline seconds, for `durationRatioBucket`. */
  timelineSeconds: number;
  /** The `studio_export_*` props (enums only). */
  props: StudioExportProps;
};

export const isStudioExportOptions = (o: unknown): o is StudioExportJobOptions =>
  !!o && typeof o === 'object' && (o as StudioExportJobOptions).tool === 'studio_export';

export type StudioExportCall = (
  o: StudioExportJobOptions,
) => Promise<{ ok: true; jobId: string } | { ok: false; error: MmError }>;

type Track = (name: string, props: Record<string, unknown>, context: Record<string, unknown>) => void;

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

const context = (jobId?: string) => ({
  tool_slug: DARKROOM_TOOL_SLUG,
  feature: 'studio',
  ...(jobId ? { job_id: jobId } : {}),
});

/** `studio_export_completed` / `_failed` for a server-settled render (start refusals emit nothing). */
export function trackStudioExportSettled(rec: JobRecord, track: Track = realTrack as Track): void {
  const o = rec.options;
  if (!isStudioExportOptions(o)) return;
  if (rec.state !== 'completed' && rec.state !== 'failed') return;
  const ran =
    rec.completedAt !== undefined && rec.acceptedAt !== undefined
      ? rec.completedAt - rec.acceptedAt
      : NaN;
  const bucket = durationRatioBucket(ran, o.timelineSeconds);
  track(
    rec.state === 'completed' ? EVENTS.STUDIO_EXPORT_COMPLETED : EVENTS.STUDIO_EXPORT_FAILED,
    { ...o.props, ...(bucket ? { durationRatioBucket: bucket } : {}) },
    context(rec.jobId),
  );
}

export function makeStudioExportStarter(
  call: StudioExportCall,
  deps: { track?: Track } = {},
): JobStarter {
  const track = deps.track ?? (realTrack as Track);
  return {
    async start(record, signal) {
      const o = record.options;
      if (!isStudioExportOptions(o) || (!o.body && !o.againExportId)) {
        return failure({
          status: 'PARSE_ERROR',
          code: 'contract_mismatch',
          details: { starter: STUDIO_EXPORT_STARTER },
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
      const r = await call(o);
      if (!r.ok) return failure(r.error);
      track(EVENTS.STUDIO_EXPORT_STARTED, { ...o.props }, context(r.jobId));
      return { ok: true, jobId: r.jobId };
    },
    settled: (rec) => trackStudioExportSettled(rec, track),
  };
}

/** The app's call: the RTK Query mutations on the real store. */
export function rtkStudioExportCall(
  dispatch: ThunkDispatch<unknown, unknown, UnknownAction>,
): StudioExportCall {
  return async (o) => {
    // Lazy: keep the API slice out of pure imports of this module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { studioApi } = require('@/studio/mobile/api') as typeof import('@/studio/mobile/api');
    const r = o.againExportId
      ? await dispatch(
          studioApi.endpoints.exportStudioAgain.initiate({
            id: o.projectId,
            exportId: o.againExportId,
          }),
        )
      : await dispatch(
          studioApi.endpoints.exportStudioProject.initiate({ id: o.projectId, body: o.body ?? {} }),
        );
    if ('error' in r && r.error) return { ok: false, error: r.error as MmError };
    return { ok: true, jobId: (r as { data: { jobId: string } }).data.jobId };
  };
}

/** The source the result describes (never uploaded): the output's name, extension and kind. */
export function studioExportSource(args: {
  projectId: string;
  fileName: string;
  ext: string;
  mime: string;
  audioOnly: boolean;
  now?: number;
}) {
  return {
    id: `studio:${args.projectId}`,
    uri: '',
    name: `${args.fileName || 'export'}.${args.ext}`,
    extension: args.ext,
    mimeType: args.mime,
    mediaKind: args.audioOnly ? ('audio' as const) : ('video' as const),
    sizeBytes: 0,
    source: 'picker' as const,
    copiedAt: args.now ?? Date.now(),
  };
}

/** The engine's `tool` for a Darkroom export record (no registry row: Darkroom has no Tools-tab entry yet). */
export const DARKROOM_EXPORT_TOOL = {
  id: 'darkroom',
  family: 'video' as const,
  analyticsSlug: DARKROOM_TOOL_SLUG,
  endpoint: 'upload' as const,
  optionsBuilder: (f: Record<string, unknown>) => f,
};
