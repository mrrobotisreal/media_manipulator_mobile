/**
 * One cap on phones (MA13 decision 6): the web's low-memory 150 MB, because the whole archive is read
 * into JS memory. Over the cap the app never reads the file.
 */
export const ARCHIVE_MAX_BYTES = 150 * 1024 * 1024;

export function isOverArchiveCap(sizeBytes: number | undefined): boolean {
  return typeof sizeBytes === 'number' && sizeBytes > ARCHIVE_MAX_BYTES;
}
