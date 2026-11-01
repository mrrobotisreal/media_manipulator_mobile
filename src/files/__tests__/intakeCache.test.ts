import { cleanupIntakeCache, copyToIntakeCache, IntakeCopyError, prepareIntake } from '../intake';
import { VIDEO_ACCEPTS } from '@/tools/families/shared';

const mockFs = new Map<string, { dir: boolean; mtime: number; size: number }>();
jest.mock('expo-file-system', () => {
  const join = (...parts: unknown[]) =>
    parts
      .map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri))
      .join('/')
      .replace(/^file:\/+/, 'file:///')
      .replace(/([^:/])\/+/g, '$1/');
  class Directory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(...parts);
    }
    get name() {
      return this.uri.split('/').pop()!;
    }
    get exists() {
      return mockFs.has(this.uri);
    }
    create() {
      mockFs.set(this.uri, { dir: true, mtime: Date.now(), size: 0 });
    }
    delete() {
      for (const k of [...mockFs.keys()])
        if (k === this.uri || k.startsWith(`${this.uri}/`)) mockFs.delete(k);
    }
    info() {
      return { exists: this.exists, modificationTime: mockFs.get(this.uri)?.mtime };
    }
    list() {
      return [...mockFs.keys()]
        .filter((k) => k.startsWith(`${this.uri}/`) && !k.slice(this.uri.length + 1).includes('/'))
        .map((k) => (mockFs.get(k)!.dir ? new Directory(k) : new File(k)));
    }
  }
  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(...parts);
    }
    get size() {
      return mockFs.get(this.uri)?.size ?? 0;
    }
    copy(dest: File) {
      if (!mockFs.has(this.uri)) throw new Error('missing');
      mockFs.set(dest.uri, { dir: false, mtime: Date.now(), size: this.size });
    }
    move() {}
  }
  return {
    Directory,
    File,
    Paths: { cache: new Directory('file:///cache'), availableDiskSpace: 10 ** 12 },
  };
});
jest.mock('../duration', () => ({ probeDuration: jest.fn(async () => undefined) }));

const DAY = 24 * 60 * 60 * 1000;
const seed = (path: string, mtime: number) =>
  mockFs.set(`file:///cache/${path}`, { dir: true, mtime, size: 0 });

beforeEach(() => mockFs.clear());

describe('copyToIntakeCache', () => {
  it('copies into cache/intake/<id>/<name> and returns a file:// uri', () => {
    mockFs.set('content://media/1', { dir: false, mtime: 0, size: 42 });
    const uri = copyToIntakeCache('content://media/1', 'abc', 'photo.jpg', 42, 10 ** 12);
    expect(uri).toBe('file:///cache/intake/abc/photo.jpg');
    expect(mockFs.get(uri)?.size).toBe(42);
  });

  it('refuses when free space is below size + 200 MB', () => {
    expect(() => copyToIntakeCache('content://x', 'a', 'f.mp4', 1000, 1000 + 100)).toThrow(
      IntakeCopyError,
    );
  });

  it('cleans up the dir and throws copy_failed when the source is unreadable', () => {
    expect(() => copyToIntakeCache('content://gone', 'a', 'f.png', 1, 10 ** 12)).toThrow(
      expect.objectContaining({ code: 'copy_failed' }),
    );
    expect(mockFs.has('file:///cache/intake/a')).toBe(false);
  });
});

describe('cleanupIntakeCache', () => {
  it('deletes dirs older than 24 h, keeps younger ones and referenced ones', () => {
    const now = 100 * DAY;
    seed('intake', now);
    seed('intake/old', now - DAY - 1);
    seed('intake/young', now - DAY + 1000);
    seed('intake/ref', now - 5 * DAY);
    seed('originals', now);
    seed('originals/oldjob', now - 2 * DAY);
    const removed = cleanupIntakeCache({ now, referencedIds: new Set(['ref']) });
    expect(removed).toBe(2);
    expect(mockFs.has('file:///cache/intake/old')).toBe(false);
    expect(mockFs.has('file:///cache/intake/young')).toBe(true);
    expect(mockFs.has('file:///cache/intake/ref')).toBe(true);
    expect(mockFs.has('file:///cache/originals/oldjob')).toBe(false);
  });

  it('is a no-op without a cache dir', () => {
    expect(cleanupIntakeCache({ now: 1 })).toBe(0);
  });
});

describe('prepareIntake', () => {
  const limits = { maxFileBytes: 1000, maxVideoSeconds: 60 };

  it('rejects oversize without copying and copies accepted files', async () => {
    mockFs.set('content://a', { dir: false, mtime: 0, size: 500 });
    const res = await prepareIntake(
      [
        {
          uri: 'content://a',
          name: 'clip.mp4',
          mimeType: 'video/mp4',
          sizeBytes: 500,
          durationSec: 30,
        },
        { uri: 'content://b', name: 'big.mp4', mimeType: 'video/mp4', sizeBytes: 5000 },
        { uri: 'content://c', name: 'x.zip', mimeType: 'application/zip', sizeBytes: 5 },
      ],
      { source: 'picker', accepts: VIDEO_ACCEPTS, limits, now: 7 },
    );
    expect(res.accepted).toHaveLength(1);
    expect(res.accepted[0]).toMatchObject({
      name: 'clip.mp4',
      extension: 'mp4',
      mediaKind: 'video',
      sizeBytes: 500,
      durationSec: 30,
      source: 'picker',
      copiedAt: 7,
    });
    expect(res.accepted[0]!.uri.startsWith('file://')).toBe(true);
    expect(res.rejected.map((r) => r.reason)).toEqual(['too_large', 'unsupported_type']);
    expect(res.rejected[0]!.limit).toBe(1000);
    expect(
      [...mockFs.keys()].filter((k) => k.includes('intake/') && !k.includes('clip')),
    ).toHaveLength(1);
  });

  it('rejects too_long from the picker duration after the copy-free pass', async () => {
    mockFs.set('content://a', { dir: false, mtime: 0, size: 5 });
    const res = await prepareIntake(
      [
        {
          uri: 'content://a',
          name: 'c.mp4',
          mimeType: 'video/mp4',
          sizeBytes: 5,
          durationSec: 120,
        },
      ],
      { source: 'documents', accepts: VIDEO_ACCEPTS, limits },
    );
    expect(res.rejected[0]).toMatchObject({ reason: 'too_long', limit: 60 });
  });

  it('a failed probe does not block', async () => {
    mockFs.set('content://a', { dir: false, mtime: 0, size: 5 });
    const res = await prepareIntake(
      [{ uri: 'content://a', name: 'c.mp4', mimeType: 'video/mp4', sizeBytes: 5 }],
      { source: 'share', accepts: VIDEO_ACCEPTS, limits },
    );
    expect(res.accepted).toHaveLength(1);
    expect(res.accepted[0]!.durationSec).toBeUndefined();
  });
});
