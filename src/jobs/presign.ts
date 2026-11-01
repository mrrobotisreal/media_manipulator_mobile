/** The API signs the PUT for `S3_PRESIGN_TTL_SECONDS` (900 s); re-request after 14 min (decision 7). */
export const PRESIGN_MAX_AGE_MS = 14 * 60 * 1000;

export const isPresignStale = (presignedAt: number, now: number): boolean =>
  now - presignedAt > PRESIGN_MAX_AGE_MS;
