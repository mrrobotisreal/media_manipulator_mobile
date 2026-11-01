import { isPresignStale } from './presign';
import type { JobTransport, UploadOutcome, UploadSource } from './transport';

export interface UploadHooks {
  onProgress(fraction: number): void;
  /** The bytes are delivered: S3 accepted the PUT, or the multipart POST was answered 2xx. */
  onBytesSent(): void;
  signal: AbortSignal;
  now(): number;
}

/**
 * One upload attempt, multipart or presigned. The presign path is
 * presign -> PUT -> complete; a presign older than 14 min when the PUT would start is re-requested.
 */
export async function runUpload(
  t: JobTransport,
  transport: 'post' | 'presigned_put',
  src: UploadSource,
  hooks: UploadHooks,
): Promise<UploadOutcome> {
  if (transport === 'post') {
    const res = await t.uploadMultipart(src, hooks.onProgress, hooks.signal);
    if (res.ok) hooks.onBytesSent();
    return res;
  }
  let signedAt = hooks.now();
  let presigned = await t.presign(src);
  if (!presigned.ok) return presigned;
  if (isPresignStale(signedAt, hooks.now())) {
    signedAt = hooks.now();
    presigned = await t.presign(src);
    if (!presigned.ok) return presigned;
  }
  const put = await t.putBinary(presigned.target, src, hooks.onProgress, hooks.signal);
  if (!put.ok) return put;
  hooks.onBytesSent();
  return t.completePresign(presigned.target, src);
}
