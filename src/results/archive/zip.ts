import { unzipSync } from 'fflate';
import { kindOfFileName } from '../describe';
import type { ArchiveEntry } from './types';

const clean = (name: string) =>
  name
    .replace(/\\/g, '/')
    .replace(/^\.?\/+/, '')
    .replace(/\/+$/, '');

/**
 * Lists a zip's entries. The `filter` rejects every file, so `unzipSync` reads the central
 * directory only and inflates nothing.
 */
export function listZip(bytes: Uint8Array): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  unzipSync(bytes, {
    filter: (file) => {
      const isDir = file.name.endsWith('/');
      const path = clean(file.name);
      if (path) {
        entries.push({
          path,
          size: isDir ? 0 : file.originalSize,
          isDir,
          kind: isDir ? 'unknown' : kindOfFileName(path),
          data: isDir ? undefined : () => extractZipEntry(bytes, path),
        });
      }
      return false;
    },
  });
  return entries;
}

/** Inflates exactly one entry (by cleaned path); throws when it is not in the archive. */
export function extractZipEntry(bytes: Uint8Array, path: string): Uint8Array {
  const out = unzipSync(bytes, {
    filter: (file) => clean(file.name) === path && !file.name.endsWith('/'),
  });
  const key = Object.keys(out).find((name) => clean(name) === path);
  if (!key) throw new Error(`Entry not found: ${path}`);
  const data = out[key];
  if (!data) throw new Error(`Entry not found: ${path}`);
  return data;
}
