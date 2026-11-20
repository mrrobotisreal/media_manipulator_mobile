/**
 * Motion (`vector`) endpoints on the one RTK Query API (ticket MA58 decision 3): the project list
 * only (`GET /vector/projects`, `internal/handlers/vector.go`; summaries, never `document`).
 * MA66 adds get/save/thumbnail next to it.
 */
import { mmApi } from '@/api/mmApi';
import { vectorProjectListSchema, type VectorProjectSummary } from '@/api/schemas/vector';
import { webUrl, WEB_BASE_URL } from '@/lib/webUrl';

export const vectorApi = mmApi.injectEndpoints({
  endpoints: (build) => ({
    listVectorProjects: build.query<VectorProjectSummary[], void>({
      query: () => ({
        url: '/vector/projects',
        schema: vectorProjectListSchema,
        skipAccountInvalidation: true,
      }),
      transformResponse: (r: { projects: VectorProjectSummary[] }) => r.projects,
    }),
  }),
});

export const { useListVectorProjectsQuery } = vectorApi;

/**
 * The web editor for a Motion project. The editor route is `/motion/[projectId]`
 * (`media-manipulator-ui` `app/(system)/motion/[projectId]/page.tsx`): chromeless and excluded from
 * the locale proxy, so it is never locale-prefixed (the web's own `motionEditorHref`).
 */
export function motionEditorWebUrl(id: string, base: string = WEB_BASE_URL): string {
  return `${base.replace(/\/+$/, '')}/motion/${encodeURIComponent(id)}`;
}

/**
 * Darkroom has no per-project URL on the web: projects open from the recents list on the Darkroom
 * page (`/[lang]/tools/content-studio`, `studio-host.tsx` keeps the open id in React state). The
 * phone opens that page, localized.
 */
export const DARKROOM_WEB_PATH = '/tools/content-studio';

export function darkroomWebUrl(localeCode: string, base: string = WEB_BASE_URL): string {
  return webUrl(DARKROOM_WEB_PATH, localeCode, base);
}
