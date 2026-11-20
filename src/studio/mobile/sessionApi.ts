/**
 * The Darkroom editor's endpoints (ticket MA61) on the one RTK Query API. Routes, bodies and errors
 * are the API's (`internal/handlers/studio.go`, `internal/models/studio.go`); response schemas are
 * the synced web Zod model (`../studioTypes`), never a second hand-made schema of the EDL.
 *
 * - `GET  /studio/projects/:id`         -> the full `StudioProject` (EDL v3 + `revision`)
 * - `PUT  /studio/projects/:id`         -> `StudioSaveProjectRequest` (with `expectedRevision`);
 *                                          409 `{error: "revision_conflict", currentRevision, updatedAt}`
 * - `GET  /studio/projects/:id/assets`  -> `{assets: StudioAsset[]}`
 * - `POST /studio/assets/presign`       -> 201 `{uploadUrl, s3Key, bucket, expiresAt}`
 * - `POST /studio/assets/complete`      -> 200 `{asset, jobId}` (ingest job; LUTs complete at once)
 *
 * The History listing, export and project creation are MA58's (`./api.ts`); this module only holds
 * what an open editor needs.
 */
import { z } from 'zod';
import type { MmError } from '@/api/errors';
import { mmApi } from '@/api/mmApi';
import {
  STUDIO_SCHEMA_VERSION,
  studioAssetCompleteResponseSchema,
  studioAssetPresignResponseSchema,
  studioAssetSchema,
  studioProjectSchema,
  type StudioAsset,
  type StudioAssetCompleteRequest,
  type StudioAssetCompleteResponse,
  type StudioAssetPresignRequest,
  type StudioAssetPresignResponse,
  type StudioProject,
  type StudioSaveProjectRequest,
} from '../studioTypes';

const enc = encodeURIComponent;
const assetListSchema = z.object({ assets: z.array(studioAssetSchema).nullable() });

export const studioSessionApi = mmApi.injectEndpoints({
  endpoints: (build) => ({
    getStudioProject: build.query<StudioProject, string>({
      query: (id) => ({
        url: `/studio/projects/${enc(id)}`,
        schema: studioProjectSchema,
        skipAccountInvalidation: true,
      }),
      keepUnusedDataFor: 0,
    }),
    saveStudioProject: build.mutation<
      StudioProject,
      { id: string; body: StudioSaveProjectRequest }
    >({
      query: ({ id, body }) => ({
        url: `/studio/projects/${enc(id)}`,
        method: 'PUT',
        body,
        schema: studioProjectSchema,
        skipAccountInvalidation: true,
      }),
    }),
    listStudioAssets: build.query<StudioAsset[], string>({
      query: (projectId) => ({
        url: `/studio/projects/${enc(projectId)}/assets`,
        schema: assetListSchema,
        skipAccountInvalidation: true,
      }),
      transformResponse: (r: { assets: StudioAsset[] | null }) => r.assets ?? [],
      keepUnusedDataFor: 0,
    }),
    presignStudioAsset: build.mutation<StudioAssetPresignResponse, StudioAssetPresignRequest>({
      query: (body) => ({
        url: '/studio/assets/presign',
        method: 'POST',
        body,
        schema: studioAssetPresignResponseSchema,
      }),
    }),
    completeStudioAsset: build.mutation<StudioAssetCompleteResponse, StudioAssetCompleteRequest>({
      query: (body) => ({
        url: '/studio/assets/complete',
        method: 'POST',
        body,
        schema: studioAssetCompleteResponseSchema,
        timeoutMs: 120_000, // the API HEADs, downloads and probes the object before answering
      }),
    }),
  }),
});

/**
 * The web store's `toSaveRequest()`: every editable project field the EDL carries, the current
 * schema version, and the compare-and-set token. `expectedRevision` is omitted (legacy
 * last-write-wins) only when the server never gave a revision.
 */
export function toSaveRequest(
  doc: StudioProject,
  expectedRevision: number | null,
): StudioSaveProjectRequest {
  return {
    name: doc.name,
    schemaVersion: STUDIO_SCHEMA_VERSION,
    fps: doc.fps,
    width: doc.width,
    height: doc.height,
    tracks: doc.tracks,
    captions: doc.captions,
    captionStyle: doc.captionStyle,
    captionsEnabled: doc.captionsEnabled,
    audio: doc.audio,
    // v3: no marker UI on the phone yet; echo loaded markers so a save never drops them.
    markers: doc.markers,
    expectedRevision: expectedRevision ?? undefined,
  };
}

/** 409 `revision_conflict`: the server's current revision, or null for any other error. */
export function studioConflictOf(
  e: MmError | undefined,
): { currentRevision: number | null; updatedAt: string | null } | null {
  if (!e || e.code !== 'revision_conflict') return null;
  const rev = e.details.currentRevision;
  const at = e.details.updatedAt;
  return {
    currentRevision: typeof rev === 'number' && Number.isInteger(rev) && rev > 0 ? rev : null,
    updatedAt: typeof at === 'string' ? at : null,
  };
}

/**
 * The web editor's split: a network failure or a 5xx retries with backoff; any other status
 * (4xx other than 409) parks the save in `failed` until the next edit.
 */
export function isRetryableSaveError(e: MmError): boolean {
  if (typeof e.status !== 'number') return true; // FETCH_ERROR / PARSE_ERROR / timeout
  return e.status >= 500;
}

type Dispatch = (action: unknown) => unknown;
type Initiated<T> = Promise<{ data?: T; error?: unknown }> & { unsubscribe?: () => void };

async function call<T>(
  dispatch: Dispatch,
  action: unknown,
): Promise<{ ok: true; value: T } | { ok: false; error: MmError }> {
  const pending = dispatch(action) as Initiated<T>;
  try {
    const r = await pending;
    if (r.error !== undefined) return { ok: false, error: r.error as MmError };
    return { ok: true, value: r.data as T };
  } finally {
    pending.unsubscribe?.();
  }
}

/** The session's API calls over the app's RTK Query store (`session.ts` takes this as `api`). */
export function studioSessionApiFor(dispatch: Dispatch) {
  const e = studioSessionApi.endpoints;
  return {
    getProject: (id: string) =>
      call<StudioProject>(dispatch, e.getStudioProject.initiate(id, { forceRefetch: true })),
    saveProject: (input: { id: string; body: StudioSaveProjectRequest }) =>
      call<StudioProject>(dispatch, e.saveStudioProject.initiate(input)),
    listAssets: (projectId: string) =>
      call<StudioAsset[]>(dispatch, e.listStudioAssets.initiate(projectId, { forceRefetch: true })),
    presign: (body: StudioAssetPresignRequest) =>
      call<StudioAssetPresignResponse>(dispatch, e.presignStudioAsset.initiate(body)),
    complete: (body: StudioAssetCompleteRequest) =>
      call<StudioAssetCompleteResponse>(dispatch, e.completeStudioAsset.initiate(body)),
  };
}
