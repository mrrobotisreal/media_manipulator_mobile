import { gunzipSync } from 'fflate';
import { isOverArchiveCap } from './limits';
import { readTar } from './tar';
import type { OpenedArchive } from './types';
import { listZip } from './zip';

export type { ArchiveEntry, OpenedArchive } from './types';
export { ARCHIVE_MAX_BYTES, isOverArchiveCap } from './limits';

export class ArchiveError extends Error {
  constructor(
    public code: 'too-large' | 'not-archive' | 'corrupt',
    message: string,
  ) {
    super(message);
    this.name = 'ArchiveError';
  }
}

const isZip = (b: Uint8Array) =>
  b.length >= 4 &&
  b[0] === 0x50 &&
  b[1] === 0x4b &&
  (b[2] === 3 || b[2] === 5) &&
  (b[3] === 4 || b[3] === 6);
const isGzip = (b: Uint8Array) => b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b;
const isTar = (b: Uint8Array) =>
  b.length >= 512 && String.fromCharCode(...b.subarray(257, 262)) === 'ustar';

/** Minimal file handle so the cap check runs before any read (a RN `File`, or a test double). */
export interface ArchiveSource {
  size: number;
  bytes(): Promise<Uint8Array>;
}

/**
 * Opens a zip, `.tar.gz` / `.tgz` or plain tar. The format is sniffed from magic bytes, not the file
 * name (`nameHint` only breaks a tie for headerless tars). Over the size cap the file is never read.
 */
export async function openArchive(source: ArchiveSource, nameHint = ''): Promise<OpenedArchive> {
  if (isOverArchiveCap(source.size)) {
    throw new ArchiveError('too-large', 'Archive is too large to preview on this device');
  }
  return openArchiveBytes(await source.bytes(), nameHint);
}

export function openArchiveBytes(bytes: Uint8Array, nameHint = ''): OpenedArchive {
  try {
    if (isZip(bytes)) return { format: 'zip', entries: listZip(bytes), truncated: false };
    if (isGzip(bytes)) {
      const tar = gunzipSync(bytes);
      return { format: 'tar.gz', ...readTar(tar) };
    }
    if (isTar(bytes) || /\.tar$/i.test(nameHint)) return { format: 'tar', ...readTar(bytes) };
  } catch (error) {
    throw new ArchiveError(
      'corrupt',
      error instanceof Error ? error.message : 'Archive could not be read',
    );
  }
  throw new ArchiveError('not-archive', 'Not a zip or tar archive');
}
