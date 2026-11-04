/**
 * Aperture project endpoints (ticket MA50 decision 5) on the one RTK Query API. Routes, bodies and
 * errors are the API's (`internal/handlers/photo.go`, RUNBOOK §4.17). Project creation is NOT
 * here: it is a multipart upload with progress, so it goes through `projectCreate.ts` (the job
 * transport's native upload task).
 */
import { mmApi } from '@/api/mmApi';
import {
  photoCapabilitiesSchema,
  photoExportResponseSchema,
  photoProjectListSchema,
  photoProjectResponseSchema,
  type PhotoCapabilities,
  type PhotoExportRequest,
  type PhotoProject,
  type PhotoProjectResponse,
} from '@/api/schemas/photo';
import type { MmError } from '@/api/errors';
import { parsePhotoDoc, type PhotoDoc } from './photoTypes';

const enc = encodeURIComponent;

export const photoApi = mmApi.injectEndpoints({
  endpoints: (build) => ({
    /** `GET /photo/capabilities`: the tier's Aperture switches and caps (cached 5 min). */
    getPhotoCapabilities: build.query<PhotoCapabilities, void>({
      query: () => ({
        url: '/photo/capabilities',
        schema: photoCapabilitiesSchema,
        skipAccountInvalidation: true,
      }),
      keepUnusedDataFor: 300,
    }),
    listPhotoProjects: build.query<PhotoProject[], { limit?: number; offset?: number } | void>({
      query: (p) => ({
        url: '/photo/projects',
        params: { limit: p?.limit, offset: p?.offset },
        schema: photoProjectListSchema,
        skipAccountInvalidation: true,
      }),
      transformResponse: (r: { projects: PhotoProject[] }) => r.projects,
      // MA52: History's Projects segment refetches after a save, an export or a delete.
      providesTags: ['PhotoProjects'],
    }),
    getPhotoProject: build.query<PhotoProjectResponse, string>({
      query: (id) => ({
        url: `/photo/projects/${enc(id)}`,
        schema: photoProjectResponseSchema,
        skipAccountInvalidation: true,
      }),
      keepUnusedDataFor: 0,
    }),
    /** `PUT` with `If-Match: <revision>`; 409 `revision_conflict {revision}` when stale. */
    savePhotoProject: build.mutation<
      PhotoProjectResponse,
      { id: string; revision: number; doc: PhotoDoc; name?: string }
    >({
      query: ({ id, revision, doc, name }) => ({
        url: `/photo/projects/${enc(id)}`,
        method: 'PUT',
        headers: { 'If-Match': String(revision) },
        body: name === undefined ? { doc } : { doc, name },
        schema: photoProjectResponseSchema,
        skipAccountInvalidation: true,
      }),
      invalidatesTags: ['PhotoProjects'],
    }),
    deletePhotoProject: build.mutation<unknown, string>({
      query: (id) => ({
        url: `/photo/projects/${enc(id)}`,
        method: 'DELETE',
        skipAccountInvalidation: true,
      }),
      invalidatesTags: ['PhotoProjects'],
    }),
    /** `POST /photo/projects/:id/export` → 202 `{jobId}` (one `ops`; the doc is saved first). */
    exportPhotoProject: build.mutation<
      { jobId: string },
      { id: string; revision?: number; body: PhotoExportRequest }
    >({
      query: ({ id, revision, body }) => ({
        url: `/photo/projects/${enc(id)}/export`,
        method: 'POST',
        headers: revision !== undefined ? { 'If-Match': String(revision) } : undefined,
        body,
        schema: photoExportResponseSchema,
      }),
    }),
  }),
});

export const {
  useGetPhotoCapabilitiesQuery,
  useListPhotoProjectsQuery,
  useGetPhotoProjectQuery,
  useSavePhotoProjectMutation,
  useDeletePhotoProjectMutation,
  useExportPhotoProjectMutation,
} = photoApi;

/** The server's doc, parsed with the shared model; a doc this build cannot read is refused, not guessed. */
export function docOf(
  r: PhotoProjectResponse,
): { ok: true; doc: PhotoDoc } | { ok: false; error: string } {
  if (r.doc === undefined) return { ok: false, error: 'photo_doc_missing' };
  const parsed = parsePhotoDoc(r.doc);
  return parsed.ok ? { ok: true, doc: parsed.doc } : { ok: false, error: parsed.error };
}

/** 409 `revision_conflict`: the server's current revision (`currentRevision` tolerated like the web). */
export function conflictRevision(e: MmError | undefined): number | null {
  if (!e || e.code !== 'revision_conflict') return null;
  const rev = e.details.revision ?? e.details.currentRevision;
  return typeof rev === 'number' && Number.isInteger(rev) && rev > 0 ? rev : null;
}
