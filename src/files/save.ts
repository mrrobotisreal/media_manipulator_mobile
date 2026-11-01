import type { File } from 'expo-file-system';
import type { ResultContext } from '@/analytics/resultEvents';
import { trackMediaSaved } from '@/analytics/saveEvents';
import { extensionOf, type ResultKind } from '@/results/describe';

export const PHOTOS_ALBUM = 'Media Manipulator';
/** Evict the cache copy after saving anything bigger than this (web `CACHED_SAVE_MAX_BYTES`). */
export const CACHE_EVICT_BYTES = 100 * 1024 * 1024;
export const COPY_CHUNK = 1024 * 1024;

export type SaveTarget = 'photos' | 'files';

/** Kind -> destination (TOOLS_V1 section 6). SVG is an image file but not gallery media. */
export function targetFor(kind: ResultKind, fileName: string): SaveTarget {
  if (kind === 'image' || kind === 'gif' || kind === 'video') {
    return extensionOf(fileName) === 'svg' ? 'files' : 'photos';
  }
  return 'files';
}

export type SaveOutcome =
  | { status: 'saved'; destination: 'photos' }
  | { status: 'saved'; destination: 'files'; folder: string }
  | { status: 'shared' }
  | { status: 'permission_denied' }
  | { status: 'cancelled' }
  | { status: 'failed'; error?: unknown };

export interface SaveDeps {
  platform: 'android' | 'ios';
  /** Add-only photo-library permission: `true` when already granted. */
  hasPhotosPermission(): Promise<boolean>;
  requestPhotosPermission(): Promise<boolean>;
  /** Android: files the asset into `Pictures|Movies/<album>` by path (no library read). iOS: no album (add-only). */
  addToPhotos(fileUri: string, album: string | null): Promise<void>;
  /** Remembered SAF folder (`settings.lastSaveDirUri`). */
  getSaveDir(): string | null;
  setSaveDir(uri: string | null): void;
  /** SAF picker. Resolves null when the user backs out. */
  pickDirectory(initialUri?: string): Promise<{ uri: string; name: string } | null>;
  /** Creates `name` in the SAF directory and streams the cached file into it. Returns the folder label. */
  writeToDirectory(
    dirUri: string,
    name: string,
    mime: string,
    source: File,
  ): Promise<{ folder: string }>;
  share(file: File, mime: string, title?: string): Promise<void>;
  evictCache(jobId: string): void;
}

export interface SaveArgs {
  file: File;
  kind: ResultKind;
  fileName: string;
  mime: string;
  context: ResultContext;
  /** "Save to Files instead" after a denied Photos permission. */
  forceTarget?: SaveTarget;
  title?: string;
  deps: SaveDeps;
}

const isCancel = (e: unknown) => /cancel/i.test(e instanceof Error ? e.message : String(e ?? ''));

function maybeEvict(args: SaveArgs): void {
  try {
    if (args.file.size > CACHE_EVICT_BYTES) args.deps.evictCache(args.context.jobId);
  } catch {
    // best effort
  }
}

/** Readable folder label from a SAF tree/document URI or name (`primary%3ADownload%2FMM` -> `MM`). */
export function folderLabel(raw: string): string {
  let s = raw;
  try {
    s = decodeURIComponent(raw);
  } catch {
    // keep raw
  }
  s = s.replace(/\/+$/, '');
  const tail = s.split(/[/:]/).filter(Boolean).pop();
  return tail || raw;
}

async function saveToPhotos(args: SaveArgs): Promise<SaveOutcome> {
  const { deps } = args;
  try {
    if (!(await deps.hasPhotosPermission()) && !(await deps.requestPhotosPermission())) {
      return { status: 'permission_denied' };
    }
    await deps.addToPhotos(args.file.uri, deps.platform === 'android' ? PHOTOS_ALBUM : null);
  } catch (error) {
    return { status: 'failed', error };
  }
  trackMediaSaved(args.context, 'photos', args.kind);
  maybeEvict(args);
  return { status: 'saved', destination: 'photos' };
}

async function saveToFolder(args: SaveArgs): Promise<SaveOutcome> {
  const { deps } = args;
  let remembered = deps.getSaveDir();
  // At most two attempts: the remembered folder, then (after a write failure or revoked grant) the picker.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let dirUri = remembered;
    if (!dirUri) {
      try {
        const picked = await deps.pickDirectory();
        if (!picked) return { status: 'cancelled' };
        dirUri = picked.uri;
      } catch (error) {
        return isCancel(error) ? { status: 'cancelled' } : { status: 'failed', error };
      }
    }
    try {
      const { folder } = await deps.writeToDirectory(dirUri, args.fileName, args.mime, args.file);
      deps.setSaveDir(dirUri);
      trackMediaSaved(args.context, 'files', args.kind);
      maybeEvict(args);
      return { status: 'saved', destination: 'files', folder };
    } catch (error) {
      if (remembered) {
        deps.setSaveDir(null);
        remembered = null;
        continue;
      }
      return { status: 'failed', error };
    }
  }
  return { status: 'failed' };
}

/** Share sheet (iOS "Save to Files" lives in it). `media_saved` fires on open: Android gives no completion. */
export async function shareResult(
  args: Pick<SaveArgs, 'file' | 'kind' | 'mime' | 'context' | 'title' | 'deps'>,
): Promise<SaveOutcome> {
  try {
    await args.deps.share(args.file, args.mime, args.title);
  } catch (error) {
    return isCancel(error) ? { status: 'cancelled' } : { status: 'failed', error };
  }
  trackMediaSaved(args.context, 'share_sheet', args.kind);
  return { status: 'shared' };
}

/**
 * Save: image/gif/video -> Photos (permission asked here, at the first save); everything else (and
 * "Save to Files instead") -> Files: Android picks a SAF folder once and remembers it, iOS opens the
 * share sheet whose "Save to Files" does the job.
 */
export async function saveResult(args: SaveArgs): Promise<SaveOutcome> {
  const target = args.forceTarget ?? targetFor(args.kind, args.fileName);
  if (target === 'photos') return saveToPhotos(args);
  if (args.deps.platform === 'ios') return shareResult(args);
  return saveToFolder(args);
}
