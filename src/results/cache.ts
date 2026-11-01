import { Directory, File, Paths } from 'expo-file-system';
import { sanitizeName } from '@/files/mime';
import { ORIGINALS_DIR } from '@/files/intake';
import { kindOfOriginal, type OriginalRef } from './describe';

/** `Paths.cache/results/<jobId>/<fileName>`: files downloaded for viewing (MA14 reuses them for Save/Share). */
export const RESULTS_DIR = 'results';
export const RESULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const safeId = (jobId: string) => jobId.replace(/[^A-Za-z0-9_-]/g, '_');

export const resultDir = (jobId: string) => new Directory(Paths.cache, RESULTS_DIR, safeId(jobId));

export function resultFile(jobId: string, fileName: string): File {
  return new File(resultDir(jobId), sanitizeName(fileName, 'result'));
}

/** The cached result when a complete copy exists. */
export function cachedResult(jobId: string, fileName: string, sizeBytes?: number): File | null {
  try {
    const f = resultFile(jobId, fileName);
    if (!f.exists || f.size <= 0) return null;
    if (sizeBytes !== undefined && sizeBytes > 0 && f.size !== sizeBytes) return null;
    return f;
  } catch {
    return null;
  }
}

/** MA14/MA15 call this when a job is deleted. */
export function evictResult(jobId: string): void {
  try {
    const d = resultDir(jobId);
    if (d.exists) d.delete();
  } catch {
    // best effort
  }
}

/** Deletes `results/<jobId>` dirs older than 7 days. Returns the number removed. */
export function sweepResultCache(now: number = Date.now(), ttlMs = RESULT_TTL_MS): number {
  let removed = 0;
  try {
    const base = new Directory(Paths.cache, RESULTS_DIR);
    if (!base.exists) return 0;
    for (const entry of base.list()) {
      if (!(entry instanceof Directory)) continue;
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
  } catch {
    // best effort
  }
  return removed;
}

/** MA12's kept original copy (`cache/originals/<jobId>/<name>`) as a descriptor ref, if still on disk. */
export function findOriginal(jobId: string, name: string, mime: string): OriginalRef | undefined {
  try {
    const f = new File(new Directory(Paths.cache, ORIGINALS_DIR, jobId), sanitizeName(name));
    if (!f.exists) return undefined;
    return { uri: f.uri, name, mime, kind: kindOfOriginal({ name, mime }) };
  } catch {
    return undefined;
  }
}

/** Deletes MA12's kept original copy (`cache/originals/<jobId>/`) when the job is deleted. */
export function evictOriginal(jobId: string): void {
  try {
    const d = new Directory(Paths.cache, ORIGINALS_DIR, jobId);
    if (d.exists) d.delete();
  } catch {
    // best effort
  }
}
