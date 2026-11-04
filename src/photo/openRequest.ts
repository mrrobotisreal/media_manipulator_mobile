/**
 * How the editor route learns what to open. `/photo/new` takes the picked/shared file handed over
 * in memory (an `IntakeFile`, like MA11's intake session: a file never travels in a URL);
 * `/photo/<projectId>` opens a saved project. Pure, tested.
 */
import type { IntakeFile } from '@/files/types';
import type { PhotoEditorSource } from '@/analytics/events';
import type { StripTool } from './ui/stripTools';

export interface PhotoOpenRequest {
  file: IntakeFile;
  source: PhotoEditorSource;
  /** The page that opened the editor (`context.tool_slug`). */
  toolSlug: string;
  /** MA52 entry rows: the sheet in front on open. */
  panel?: StripTool;
  /** MA52 entry rows: a built-in look applied once the photo is open. */
  preset?: string;
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

/** Where a saved project was opened from (MA52): `photo_editor_opened.source` for `/photo/<id>`. */
export type SavedProjectSource = 'history' | 'projects';

export const parseSavedSource = (raw: unknown): SavedProjectSource =>
  raw === 'history' ? 'history' : 'projects';

/** A tool slug from a route param (the analytics `tool_slug` rules: `[a-z0-9-]`, short). */
export const parseSlugParam = (raw: unknown): string | undefined =>
  typeof raw === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(raw) ? raw : undefined;

export const editorHref = (
  projectId: string,
  opts: { from?: SavedProjectSource; slug?: string } = {},
) => {
  const q = [
    opts.from ? `from=${opts.from}` : '',
    opts.slug && parseSlugParam(opts.slug) ? `slug=${opts.slug}` : '',
  ].filter(Boolean);
  return `/(app)/photo/${encodeURIComponent(projectId)}${q.length ? `?${q.join('&')}` : ''}`;
};
