import type { UploadSource } from './transport';

export const snapshotSrc = (over: Partial<UploadSource> = {}): UploadSource => ({
  fileUri: 'file:///cache/intake/i1/photo.jpg',
  fileName: 'photo.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 1000,
  options: { format: 'png' },
  ...over,
});

export const HEADERS_QUOTA = {
  'X-MM-Tier': 'free',
  'X-MM-Quota-Limit': '10',
  'X-MM-Quota-Remaining': '7',
  'X-MM-Quota-Reset': '2026-11-02T00:00:00Z',
  'X-MM-Quota-Metric': 'ops',
};
