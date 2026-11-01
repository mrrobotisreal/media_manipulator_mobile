import { Directory, File, Paths } from 'expo-file-system';
import { uuidv4 } from '@/lib/ids';
import { probeDuration } from './duration';
import { extensionOf, resolveKind, resolveMime, sanitizeName } from './mime';
import { preflightFile, type PreflightLimits } from './preflight';
import type { ToolAccepts } from '@/tools/types';
import type { IncomingFile, IntakeFile, IntakeSource, Rejection } from './types';

export const INTAKE_DIR = 'intake';
export const ORIGINALS_DIR = 'originals';
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Free space that must remain after the copy (ticket risk: size + 200 MB). */
export const FREE_SPACE_MARGIN_BYTES = 200 * 1024 * 1024;

export class IntakeCopyError extends Error {
  constructor(readonly code: 'low_space' | 'copy_failed') {
    super(code);
  }
}

const root = (name: string) => new Directory(Paths.cache, name);

export function intakeDirFor(id: string): Directory {
  return new Directory(root(INTAKE_DIR), id);
}

/** Copies one incoming URI into `cache/intake/<id>/<name>` and returns its `file://` URI. */
export function copyToIntakeCache(
  srcUri: string,
  id: string,
  safeName: string,
  sizeHint: number,
  availableBytes: number = Paths.availableDiskSpace,
): string {
  if (Number.isFinite(availableBytes) && availableBytes < sizeHint + FREE_SPACE_MARGIN_BYTES) {
    throw new IntakeCopyError('low_space');
  }
  const dir = intakeDirFor(id);
  try {
    dir.create({ intermediates: true, idempotent: true });
    const dest = new File(dir, safeName);
    new File(srcUri).copy(dest);
    return dest.uri;
  } catch {
    deleteIntakeDir(id);
    throw new IntakeCopyError('copy_failed');
  }
}

export function deleteIntakeDir(id: string): void {
  try {
    const dir = intakeDirFor(id);
    if (dir.exists) dir.delete();
  } catch {
    // best effort
  }
}

/** MA12 calls this after a completed upload. */
export function releaseIntakeFile(id: string): void {
  deleteIntakeDir(id);
}

/** Image originals are kept for MA13's compare: moved to `cache/originals/<jobId>/`. */
export function keepOriginal(file: IntakeFile, jobId: string): string | null {
  try {
    const dest = new Directory(root(ORIGINALS_DIR), jobId);
    dest.create({ intermediates: true, idempotent: true });
    const target = new File(dest, sanitizeName(file.name));
    new File(file.uri).move(target);
    deleteIntakeDir(file.id);
    return target.uri;
  } catch {
    return null;
  }
}

export interface CleanupOptions {
  now?: number;
  /** Intake ids referenced by a non-terminal job; these survive regardless of age. */
  referencedIds?: ReadonlySet<string>;
  ttlMs?: number;
}

function sweepDir(dirName: string, now: number, ttlMs: number, keep: ReadonlySet<string>): number {
  let removed = 0;
  const base = root(dirName);
  if (!base.exists) return 0;
  for (const entry of base.list()) {
    if (!(entry instanceof Directory)) continue;
    const id = entry.name;
    if (keep.has(id)) continue;
    const info = entry.info();
    const stamp = info.modificationTime ?? info.creationTime;
    if (stamp === undefined || stamp === null) continue;
    if (now - stamp > ttlMs) {
      try {
        entry.delete();
        removed += 1;
      } catch {
        // retry next sweep
      }
    }
  }
  return removed;
}

/**
 * Deletes `intake/<id>` and `originals/<id>` dirs older than 24 h that no non-terminal job references.
 * Younger dirs always survive so a freshly picked file is never swept from under the user; this is the
 * deliberate reading of the ticket's "older than 24 h and unreferenced" rule. Returns the number removed.
 */
export function cleanupIntakeCache(opts: CleanupOptions = {}): number {
  const now = opts.now ?? Date.now();
  const ttl = opts.ttlMs ?? CACHE_TTL_MS;
  const keep = opts.referencedIds ?? new Set<string>();
  return sweepDir(INTAKE_DIR, now, ttl, keep) + sweepDir(ORIGINALS_DIR, now, ttl, keep);
}

export interface PrepareContext {
  source: IntakeSource;
  accepts?: ToolAccepts;
  /** undefined while the account snapshot loads: size/duration checks are skipped. */
  limits?: PreflightLimits;
  now?: number;
}

export interface PrepareResult {
  accepted: IntakeFile[];
  rejected: Rejection[];
}

/**
 * Turns picker/share output into accepted `IntakeFile`s and `Rejection`s. Metadata-only checks run first
 * so an oversize or unsupported file is never copied; accepted files are copied, probed for duration
 * (video/audio, picker duration used first) and re-checked for `too_long`.
 */
export async function prepareIntake(
  incoming: IncomingFile[],
  ctx: PrepareContext,
): Promise<PrepareResult> {
  const accepted: IntakeFile[] = [];
  const rejected: Rejection[] = [];
  const now = ctx.now ?? Date.now();

  for (const item of incoming) {
    const id = uuidv4();
    const name = item.name?.trim() || item.uri.split('/').pop() || 'file';
    const extension = extensionOf(name);
    const mimeType = resolveMime(item.mimeType, extension);
    const mediaKind = resolveKind(mimeType, extension);
    let sizeBytes = item.sizeBytes ?? -1;
    if (sizeBytes < 0) {
      try {
        sizeBytes = new File(item.uri).size;
      } catch {
        sizeBytes = -1;
      }
    }
    const known = sizeBytes >= 0;
    const base = { id, name, extension, mediaKind, sizeBytes: known ? sizeBytes : null };
    const meta = {
      extension,
      mimeType,
      mediaKind,
      sizeBytes: known ? sizeBytes : 1,
      durationSec: item.durationSec ?? undefined,
    };
    const first = preflightFile(meta, ctx.accepts, ctx.limits);
    if (!first.ok) {
      rejected.push({
        ...base,
        durationSec: meta.durationSec,
        reason: first.reason,
        limit: first.limit,
      });
      continue;
    }
    if (!mediaKind) continue;

    const safeName = sanitizeName(name, `file${extension ? `.${extension}` : ''}`);
    const uri = copyToIntakeCache(item.uri, id, safeName, known ? sizeBytes : 0);
    let size = sizeBytes;
    if (!known) {
      try {
        size = new File(uri).size;
      } catch {
        size = 0;
      }
    }
    let durationSec = meta.durationSec;
    if (durationSec === undefined && (mediaKind === 'video' || mediaKind === 'audio')) {
      durationSec = await probeDuration(uri, mediaKind);
    }
    const second = preflightFile(
      { ...meta, sizeBytes: size, durationSec },
      ctx.accepts,
      ctx.limits,
    );
    if (!second.ok) {
      deleteIntakeDir(id);
      rejected.push({
        ...base,
        sizeBytes: size,
        durationSec,
        reason: second.reason,
        limit: second.limit,
      });
      continue;
    }
    accepted.push({
      id,
      uri,
      name,
      extension,
      mimeType,
      mediaKind,
      sizeBytes: size,
      ...(durationSec !== undefined ? { durationSec } : {}),
      ...(item.width ? { width: item.width } : {}),
      ...(item.height ? { height: item.height } : {}),
      source: ctx.source,
      copiedAt: now,
    });
  }
  return { accepted, rejected };
}
