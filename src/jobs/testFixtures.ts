import type { ConversionJob } from '@/api/schemas/job';
import type { JobRecord } from './types';

export const record = (over: Partial<JobRecord> = {}): JobRecord => ({
  localId: 'local_1',
  toolId: 'image-convert',
  family: 'image',
  analyticsSlug: 'image-converter',
  transport: 'post',
  intakeFileId: 'intake-1',
  fileUri: 'file:///cache/intake/intake-1/photo.jpg',
  fileName: 'photo.jpg',
  mimeType: 'image/jpeg',
  sourceExtension: 'jpg',
  sizeBytes: 1000,
  mediaKind: 'image',
  options: { format: 'png' },
  optionsHash: 'abcd1234',
  state: 'queued',
  uploadProgress: 0,
  progress: 0,
  createdAt: 1,
  watch: false,
  ...over,
});

export const snapshot = (over: Partial<ConversionJob> = {}): ConversionJob => ({
  id: 'job-1',
  status: 'processing',
  originalFile: { name: 'photo.jpg', size: 1000, type: 'image/jpeg' },
  options: {},
  createdAt: '2026-11-01T00:00:00Z',
  ...over,
});
