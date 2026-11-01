import type { ResultKind } from '../describe';

export interface ArchiveEntry {
  /** Forward-slash path inside the archive, no trailing slash for directories. */
  path: string;
  size: number;
  isDir: boolean;
  kind: ResultKind;
  /** Extracts the entry's bytes (only this entry is inflated). Absent for directories. */
  data?: () => Uint8Array;
}

export interface OpenedArchive {
  format: 'zip' | 'tar.gz' | 'tar';
  entries: ArchiveEntry[];
  /** True when a tar ended mid-entry; `entries` holds what was read before that. */
  truncated: boolean;
}
