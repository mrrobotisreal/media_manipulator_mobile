/**
 * How the editor route learns what to open. `/photo/new` takes the picked/shared file handed over
 * in memory (an `IntakeFile`, like MA11's intake session: a file never travels in a URL);
 * `/photo/<projectId>` opens a saved project. Pure, tested.
 */
import type { IntakeFile } from '@/files/types';
import type { PhotoEditorSource } from '@/analytics/events';

export interface PhotoOpenRequest {
  file: IntakeFile;
  source: PhotoEditorSource;
  /** The page that opened the editor (`context.tool_slug`). */
  toolSlug: string;
}

let pending: PhotoOpenRequest | null = null;

export function setPhotoOpenRequest(r: PhotoOpenRequest | null): void {
  pending = r;
}

/** Read and clear (a back-and-forward must not reopen a consumed file). */
export function takePhotoOpenRequest(): PhotoOpenRequest | null {
  const r = pending;
  pending = null;
  return r;
}

export const NEW_PROJECT = 'new';
export const editorHref = (projectId: string) => `/(app)/photo/${encodeURIComponent(projectId)}`;
