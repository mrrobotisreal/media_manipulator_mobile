/**
 * Pure export-dialog logic (ticket MA50 decision 8; the web's `lib/photo/projectsApi.ts` table and
 * `components/photo/export-dialog.tsx` rules): the Max size options, which are locked on a plan,
 * the size estimate, the request body and the analytics props.
 */
import type { PhotoExportFormat, PhotoExportRequest } from '@/api/schemas/photo';
import type { PhotoDoc } from './photoTypes';

/** Max-size options; 0 = Original. */
export const MAX_SIZE_OPTIONS = [0, 12, 24, 64, 120] as const;
export type MaxSizeOption = (typeof MAX_SIZE_OPTIONS)[number];

/** The web's rule (`isSizeLocked`): above the plan's cap is locked; Original when the photo is above it. */
export function isSizeLocked(
  option: MaxSizeOption,
  capMegapixels: number,
  originalMegapixels = 0,
): boolean {
  if (capMegapixels <= 0) return false; // unlimited (operator)
  if (option === 0) return originalMegapixels > capMegapixels;
  return option > capMegapixels;
}

/** MM99 bytes-per-MP table (JPG q92 ~ 0.45 MB/MP …); lossy formats scale with quality. */
const lossy = (refBytes: number) => (q: number) =>
  refBytes * (0.2 + 0.8 * Math.pow(Math.max(1, Math.min(100, q)) / 92, 2));
export const BYTES_PER_MP: Record<PhotoExportFormat, (quality: number) => number> = {
  jpg: lossy(450_000),
  webp: lossy(300_000),
  avif: lossy(200_000),
  png: () => 2_500_000,
  tiff: () => 3_000_000,
};

export const estimateExportBytes = (
  format: PhotoExportFormat,
  quality: number,
  megapixels: number,
) => Math.round(BYTES_PER_MP[format](quality) * megapixels);

export const formatBytes = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`;

export interface ExportChoice {
  format: PhotoExportFormat;
  quality: number;
  metadataMode: 'keep' | 'strip';
  maxSize: MaxSizeOption;
}

export const megapixelsOf = (doc: Pick<PhotoDoc, 'source'>) =>
  (doc.source.width * doc.source.height) / 1_000_000;

/** What the server will render: the requested size clamped to the plan's cap. */
export function effectiveMegapixels(
  doc: Pick<PhotoDoc, 'source'>,
  maxSize: MaxSizeOption,
  capMegapixels: number,
): number {
  const original = megapixelsOf(doc);
  const requested = maxSize === 0 ? original : Math.min(original, maxSize);
  return capMegapixels > 0 ? Math.min(requested, capMegapixels) : requested;
}

export const qualityApplies = (f: PhotoExportFormat) => f !== 'png' && f !== 'tiff';

/** The `POST /photo/projects/:id/export` body; the doc rides along and is saved first. */
export function exportBody(doc: PhotoDoc, c: ExportChoice, name?: string): PhotoExportRequest {
  return {
    doc,
    format: c.format,
    quality: c.quality,
    metadataMode: c.metadataMode,
    ...(c.maxSize ? { maxMegapixels: c.maxSize } : {}),
    ...(name ? { name } : {}),
  };
}

// --- analytics (the web's lib/analytics/buckets.ts boundaries) ------------------------------

export function photoMegapixelBucket(mp: number): '<=2' | '<=8' | '<=16' | '<=32' | '>32' {
  if (!(mp > 2)) return '<=2';
  if (mp <= 8) return '<=8';
  if (mp <= 16) return '<=16';
  if (mp <= 32) return '<=32';
  return '>32';
}
export function countBucket(n: number): string {
  if (n <= 0) return '0';
  if (n <= 10) return '1-10';
  if (n <= 50) return '11-50';
  if (n <= 200) return '51-200';
  return '200+';
}
export function batchBucket(n: number): string {
  if (n <= 1) return '1';
  if (n <= 5) return '2-5';
  if (n <= 20) return '6-20';
  return '20+';
}
export function bytesBucket(bytes: number): string {
  const kb = bytes / 1024;
  if (!(kb >= 10)) return '<10kb';
  if (kb < 100) return '10-100kb';
  if (kb < 1024) return '100kb-1mb';
  if (kb < 10 * 1024) return '1-10mb';
  if (kb < 100 * 1024) return '10-100mb';
  return '100mb+';
}
export function msBucket(ms: number): string {
  if (!(ms >= 100)) return '<100ms';
  if (ms < 1000) return '100ms-1s';
  if (ms < 5000) return '1-5s';
  if (ms < 30000) return '5-30s';
  if (ms < 120000) return '30s-2m';
  return '2m+';
}

/** Named masks plus inline layer masks (the web's `maskCount`). */
export function maskCount(doc: PhotoDoc): number {
  const inline = doc.layers.filter((l) => l.mask && !('ref' in l.mask)).length;
  return inline + Object.keys(doc.masks ?? {}).length;
}

/**
 * `job_started.options_hash` for an export (ticket decision 8, proposed; MM101 pinned no web recipe):
 * `<layers>l-<masks>m-<format>-<mpBucket>`, e.g. `19l-0m-jpg-<=16`. Counts are exact here (the
 * hash is a low-cardinality recipe id, not a property of the doc's content).
 */
export function exportOptionsHash(
  doc: PhotoDoc,
  format: PhotoExportFormat,
  megapixels: number,
): string {
  return `${doc.layers.length}l-${maskCount(doc)}m-${format}-${photoMegapixelBucket(megapixels)}`;
}
