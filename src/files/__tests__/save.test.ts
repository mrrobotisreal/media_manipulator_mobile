import { track } from '@/analytics/track';
import {
  saveResult,
  shareResult,
  targetFor,
  folderLabel,
  PHOTOS_ALBUM,
  type SaveDeps,
} from '../save';

jest.mock('@/analytics/track', () => ({ track: jest.fn() }));

const ctx = { jobId: 'job-1', toolSlug: 'x', mediaKind: 'image' as const };
const file = (size = 10) => ({ uri: 'file:///cache/results/job-1/out.png', size }) as never;

function deps(over: Partial<SaveDeps> = {}) {
  let granted = false;
  const d = {
    platform: 'android',
    hasPhotosPermission: jest.fn(async () => granted),
    requestPhotosPermission: jest.fn(async () => {
      granted = true;
      return true;
    }),
    addToPhotos: jest.fn(async () => undefined),
    getSaveDir: jest.fn(() => null as string | null),
    setSaveDir: jest.fn(),
    pickDirectory: jest.fn(async () => ({ uri: 'content://tree/dl', name: 'Download' })),
    writeToDirectory: jest.fn(async () => ({ folder: 'Download' })),
    share: jest.fn(async () => undefined),
    evictCache: jest.fn(),
    ...over,
  } as SaveDeps & Record<string, jest.Mock>;
  return d;
}

const base = (d: SaveDeps, over = {}) => ({
  file: file(),
  kind: 'image' as const,
  fileName: 'out.png',
  mime: 'image/png',
  context: ctx,
  deps: d,
  ...over,
});
const saved = () => (track as jest.Mock).mock.calls.filter((c) => c[0] === 'media_saved');

beforeEach(() => (track as jest.Mock).mockClear());

describe('targetFor', () => {
  it.each([
    ['image', 'a.png', 'photos'],
    ['gif', 'a.gif', 'photos'],
    ['video', 'a.mp4', 'photos'],
    ['image', 'a.svg', 'files'],
    ['audio', 'a.mp3', 'files'],
    ['pdf', 'a.pdf', 'files'],
    ['archive', 'a.zip', 'files'],
    ['unknown', 'a.bin', 'files'],
    ['transcript', 'a.txt', 'files'],
  ] as const)('%s %s -> %s', (kind, name, want) => {
    expect(targetFor(kind, name)).toBe(want);
  });
});

describe('Save to Photos', () => {
  it('asks for permission at the first save only, and files into the album on Android', async () => {
    const d = deps();
    expect(await saveResult(base(d))).toEqual({ status: 'saved', destination: 'photos' });
    expect(await saveResult(base(d))).toEqual({ status: 'saved', destination: 'photos' });
    expect(d.requestPhotosPermission).toHaveBeenCalledTimes(1);
    expect(d.addToPhotos).toHaveBeenCalledWith(expect.any(String), PHOTOS_ALBUM);
    expect(saved()).toHaveLength(2);
    expect(saved()[0]![1]).toEqual({ destination: 'photos', media_kind: 'image' });
  });

  it('iOS adds without an album (add-only access cannot touch albums)', async () => {
    const d = deps({ platform: 'ios' });
    await saveResult(base(d));
    expect(d.addToPhotos).toHaveBeenCalledWith(expect.any(String), null);
  });

  it('denied permission returns permission_denied and saves nothing', async () => {
    const d = deps({ requestPhotosPermission: jest.fn(async () => false) });
    expect(await saveResult(base(d))).toEqual({ status: 'permission_denied' });
    expect(d.addToPhotos).not.toHaveBeenCalled();
    expect(saved()).toHaveLength(0);
  });

  it('"Save to Files instead" routes an image to Files', async () => {
    const d = deps();
    const r = await saveResult(base(d, { forceTarget: 'files' }));
    expect(r).toEqual({ status: 'saved', destination: 'files', folder: 'Download' });
    expect(d.addToPhotos).not.toHaveBeenCalled();
  });

  it('a library failure is reported as failed with no media_saved', async () => {
    const d = deps({ addToPhotos: jest.fn(async () => Promise.reject(new Error('boom'))) });
    expect((await saveResult(base(d))).status).toBe('failed');
    expect(saved()).toHaveLength(0);
  });

  it('evicts the cache copy after a save over 100 MB', async () => {
    const d = deps();
    await saveResult(base(d, { file: file(101 * 1024 * 1024) }));
    expect(d.evictCache).toHaveBeenCalledWith('job-1');
    (d.evictCache as jest.Mock).mockClear();
    await saveResult(base(d));
    expect(d.evictCache).not.toHaveBeenCalled();
  });
});

describe('Save to Files', () => {
  const audio = { kind: 'audio' as const, fileName: 'song.mp3', mime: 'audio/mpeg' };

  it('first save opens the picker and remembers the folder; no media_saved name leak', async () => {
    const d = deps();
    const r = await saveResult(base(d, audio));
    expect(r).toEqual({ status: 'saved', destination: 'files', folder: 'Download' });
    expect(d.pickDirectory).toHaveBeenCalledTimes(1);
    expect(d.setSaveDir).toHaveBeenCalledWith('content://tree/dl');
    expect(saved()[0]![1]).toEqual({ destination: 'files', media_kind: 'audio' });
  });

  it('reuses the remembered folder without the picker', async () => {
    const d = deps({ getSaveDir: jest.fn(() => 'content://tree/dl') });
    await saveResult(base(d, audio));
    expect(d.pickDirectory).not.toHaveBeenCalled();
    expect(d.writeToDirectory).toHaveBeenCalledWith(
      'content://tree/dl',
      'song.mp3',
      'audio/mpeg',
      expect.anything(),
    );
  });

  it('a failed write to the remembered folder clears it and falls back to the picker', async () => {
    const write = jest
      .fn()
      .mockRejectedValueOnce(new Error('revoked'))
      .mockResolvedValueOnce({ folder: 'Music' });
    const d = deps({ getSaveDir: jest.fn(() => 'content://tree/old'), writeToDirectory: write });
    const r = await saveResult(base(d, audio));
    expect(r).toEqual({ status: 'saved', destination: 'files', folder: 'Music' });
    expect(d.setSaveDir).toHaveBeenCalledWith(null);
    expect(d.pickDirectory).toHaveBeenCalledTimes(1);
  });

  it('backing out of the picker is a cancel', async () => {
    const d = deps({ pickDirectory: jest.fn(async () => null) });
    expect(await saveResult(base(d, audio))).toEqual({ status: 'cancelled' });
    expect(saved()).toHaveLength(0);
  });

  it('a write failure on a freshly picked folder is reported, not retried forever', async () => {
    const d = deps({ writeToDirectory: jest.fn(async () => Promise.reject(new Error('disk'))) });
    expect((await saveResult(base(d, audio))).status).toBe('failed');
    expect(d.writeToDirectory).toHaveBeenCalledTimes(1);
  });

  it('iOS opens the share sheet instead of a folder picker', async () => {
    const d = deps({ platform: 'ios' });
    expect(await saveResult(base(d, audio))).toEqual({ status: 'shared' });
    expect(d.pickDirectory).not.toHaveBeenCalled();
    expect(saved()[0]![1]).toMatchObject({ destination: 'share_sheet' });
  });
});

describe('shareResult', () => {
  it('shares the file and emits media_saved share_sheet on open', async () => {
    const d = deps();
    expect(await shareResult({ ...base(d), kind: 'pdf' })).toEqual({ status: 'shared' });
    expect(d.share).toHaveBeenCalled();
    expect(saved()[0]![1]).toEqual({ destination: 'share_sheet', media_kind: 'document' });
  });

  it('a share failure emits nothing', async () => {
    const d = deps({ share: jest.fn(async () => Promise.reject(new Error('nope'))) });
    expect((await shareResult(base(d))).status).toBe('failed');
    expect(saved()).toHaveLength(0);
  });
});

describe('folderLabel', () => {
  it('reads a folder name out of a SAF id', () => {
    expect(folderLabel('primary%3ADownload%2FMM')).toBe('MM');
    expect(folderLabel('Download')).toBe('Download');
  });
});
