/**
 * Darkroom (`studio`) endpoints on the one RTK Query API (ticket MA58 decisions 1-2). Routes and
 * bodies are the API's (`internal/handlers/studio.go` routes, `studio_exports.go`): the project
 * list (summaries), the output table, export, the export history and export again. MA61 adds the
 * editor routes (get/save, assets, captions, frame) next to these.
 *
 * No cache tags: the History list refetches on pull-to-refresh and on focus, and the exports list
 * refetches after Export again, so no `tagTypes` entry is needed on the shared `mmApi`.
 */
import { mmApi } from '@/api/mmApi';
import {
  studioExportListSchema,
  studioExportOptionsSchema,
  studioExportResponseSchema,
  studioProjectListSchema,
  type StudioExportOptions,
  type StudioExportRequest,
  type StudioExportRow,
  type StudioProjectSummary,
} from '@/api/schemas/studio';
import { API_BASE_URL } from '@/api/config';

const enc = encodeURIComponent;

export const studioApi = mmApi.injectEndpoints({
  endpoints: (build) => ({
    /** `GET /studio/projects`: the caller's newest 25 projects (account-scoped with a token). */
    listStudioProjects: build.query<StudioProjectSummary[], void>({
      query: () => ({
        url: '/studio/projects',
        schema: studioProjectListSchema,
        skipAccountInvalidation: true,
      }),
      transformResponse: (r: { projects: StudioProjectSummary[] }) => r.projects,
    }),
    /** `GET /studio/export-options`: the output table, the live ladder and the caller's set. */
    getStudioExportOptions: build.query<StudioExportOptions, void>({
      query: () => ({
        url: '/studio/export-options',
        schema: studioExportOptionsSchema,
        skipAccountInvalidation: true,
      }),
      // The answer is per caller (tier); the API sends `private, max-age=300`.
      keepUnusedDataFor: 300,
    }),
    /** `POST /studio/projects/:id/export` -> 200 `{jobId}` (one `export` unit). */
    exportStudioProject: build.mutation<{ jobId: string }, { id: string; body: StudioExportRequest }>(
      {
        query: ({ id, body }) => ({
          url: `/studio/projects/${enc(id)}/export`,
          method: 'POST',
          body,
          schema: studioExportResponseSchema,
        }),
      },
    ),
    /** `GET /studio/projects/:id/exports`: the render history, newest first. */
    listStudioExports: build.query<StudioExportRow[], string>({
      query: (id) => ({
        url: `/studio/projects/${enc(id)}/exports`,
        schema: studioExportListSchema,
        skipAccountInvalidation: true,
      }),
      transformResponse: (r: { exports: StudioExportRow[] }) => r.exports,
      keepUnusedDataFor: 0,
    }),
    /** `POST /studio/projects/:id/exports/:exportId/again`: the stored options as a new export. */
    exportStudioAgain: build.mutation<{ jobId: string }, { id: string; exportId: string }>({
      query: ({ id, exportId }) => ({
        url: `/studio/projects/${enc(id)}/exports/${enc(exportId)}/again`,
        method: 'POST',
        schema: studioExportResponseSchema,
      }),
    }),
  }),
});

export const {
  useListStudioProjectsQuery,
  useGetStudioExportOptionsQuery,
  useExportStudioProjectMutation,
  useListStudioExportsQuery,
  useExportStudioAgainMutation,
} = studioApi;

/**
 * The Darkroom row's thumbnail: tile 0 of the first video clip's filmstrip sprite
 * (`GET /studio/assets/:id/sprite`, 60 tiles of 160 px in one row; capability URL, not
 * owner-scoped). Null when the project has no clip on a video track.
 */
export function studioThumbAssetId(p: Pick<StudioProjectSummary, 'tracks'>): string | null {
  for (const track of p.tracks) {
    if (track.kind !== 'video') continue;
    const clip = track.clips.find((c) => c.assetId);
    if (clip?.assetId) return clip.assetId;
  }
  return null;
}

export function studioSpriteUri(assetId: string, base: string = API_BASE_URL): string {
  return `${base}/studio/assets/${enc(assetId)}/sprite`;
}
