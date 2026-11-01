import type { MediaKind } from '@/tools/types';

export type IntakeSource = 'picker' | 'documents' | 'share';

/** A stable local copy of a user file. `name` is display-only and never leaves the device. */
export interface IntakeFile {
  id: string;
  /** file:// URI inside the app cache; never a content:// URI. */
  uri: string;
  name: string;
  /** Lower-case, no dot. */
  extension: string;
  mimeType: string;
  mediaKind: MediaKind;
  sizeBytes: number;
  durationSec?: number;
  width?: number;
  height?: number;
  source: IntakeSource;
  copiedAt: number;
}

/** What a picker or the share module hands over before the copy. Duration is in seconds. */
export interface IncomingFile {
  uri: string;
  name?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  durationSec?: number | null;
  width?: number | null;
  height?: number | null;
}

export const MAX_FILES_PER_SELECTION = 10;

/** `file_rejected.reason` values. */
export type RejectReason = 'unsupported_type' | 'too_large' | 'too_long' | 'empty' | 'too_many';

export type PreflightResult = { ok: true } | { ok: false; reason: RejectReason; limit?: number };

/** A refusal that carries what the card needs to render. */
export interface Rejection {
  id: string;
  name: string;
  extension: string;
  mediaKind: MediaKind | null;
  sizeBytes: number | null;
  durationSec?: number;
  reason: RejectReason;
  /** Bytes for too_large, seconds for too_long, count for too_many. */
  limit?: number;
}
