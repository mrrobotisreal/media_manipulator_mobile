/**
 * History "Edit again" (ticket MA52 decision 3): an Aperture export (`photo_export` job) carries
 * its project id in the job's options (`options.projectId`, set by the API's `startExport` for a
 * project export; a stateless export has `sourcePath` instead and no project). The result screen
 * offers Edit again only while `GET /photo/projects/:id` answers 200; a 404 (deleted, or not the
 * caller's) hides it. Pure helpers + one hook, tested.
 */
import { skipToken } from '@reduxjs/toolkit/query';
import type { ConversionJob } from '@/api/schemas/job';
import { useGetPhotoProjectQuery } from './projectsApi';

const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The project an Aperture export came from, or null (not an export, a stateless export, a bad id). */
export function exportProjectId(job: Pick<ConversionJob, 'options'> | undefined): string | null {
  const o = job?.options;
  if (!o || o.tool !== 'photo_export') return null;
  const id = o.projectId;
  return typeof id === 'string' && PROJECT_ID.test(id) ? id : null;
}

export type EditAgainState =
  { kind: 'hidden' } | { kind: 'checking' } | { kind: 'ready'; projectId: string };

/** Edit again for a result: `ready` only on a 200 for the job's project. */
export function useEditAgain(job: Pick<ConversionJob, 'options'> | undefined): EditAgainState {
  const projectId = exportProjectId(job);
  const q = useGetPhotoProjectQuery(projectId ?? skipToken);
  if (!projectId) return { kind: 'hidden' };
  if (q.data) return { kind: 'ready', projectId };
  if (q.isError) return { kind: 'hidden' };
  return { kind: 'checking' };
}
