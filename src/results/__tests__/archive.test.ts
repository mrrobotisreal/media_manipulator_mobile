import { gzipSync, strToU8, zipSync } from 'fflate';
import { ARCHIVE_MAX_BYTES, isOverArchiveCap } from '../archive/limits';
import { ArchiveError, openArchive, openArchiveBytes } from '../archive';
import { readTar } from '../archive/tar';
import { writeTar } from '../archive/testTar';
import { extractZipEntry, listZip } from '../archive/zip';

const text = (s: string) => strToU8(s);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

describe('zip', () => {
  const zip = zipSync({
    'frames/': new Uint8Array(),
    'frames/frame_0001.png': text('png-1'),
    'frames/sub/кадр_два.jpg': text('jpg-2'),
    'readme.txt': text('hello'),
  });

  it('lists nested folders and unicode names with kinds', () => {
    const byPath = Object.fromEntries(listZip(zip).map((e) => [e.path, e]));
    expect(byPath['frames']?.isDir).toBe(true);
    expect(byPath['frames/frame_0001.png']?.kind).toBe('image');
    expect(byPath['frames/sub/кадр_два.jpg']?.size).toBe(5);
    expect(byPath['readme.txt']?.kind).toBe('unknown');
  });

  it('extracts exactly one entry', () => {
    expect(decode(extractZipEntry(zip, 'readme.txt'))).toBe('hello');
    expect(decode(listZip(zip).find((e) => e.path === 'frames/frame_0001.png')!.data!())).toBe(
      'png-1',
    );
    expect(() => extractZipEntry(zip, 'nope')).toThrow();
  });
});

describe('tar.gz', () => {
  const longPath = `${'d'.repeat(58)}/${'f'.repeat(58)}.mp4`;

  it('lists files, a directory and a 120-char path from a generated .tar.gz fixture', () => {
    const tar = writeTar([
      { path: 'frames', dir: true },
      { path: 'frames/f1.jpg', data: text('jpg') },
      { path: longPath, data: text('video') },
    ]);
    const opened = openArchiveBytes(gzipSync(tar), 'frames.tar.gz');
    expect(opened.format).toBe('tar.gz');
    expect(opened.truncated).toBe(false);
    expect(opened.entries.map((e) => e.path)).toEqual(['frames', 'frames/f1.jpg', longPath]);
    expect(opened.entries[1]?.kind).toBe('image');
    expect(decode(opened.entries[2]!.data!())).toBe('video');
  });

  it('returns partial entries with truncated true, never throws on short garbage', () => {
    const tar = writeTar(
      [
        { path: 'a.txt', data: text('first') },
        { path: 'b.bin', data: new Uint8Array(2000) },
      ],
      { terminate: false },
    );
    const result = readTar(tar.subarray(0, 1024 + 600));
    expect(result.truncated).toBe(true);
    expect(result.entries.map((e) => e.path)).toEqual(['a.txt']);
    expect(readTar(new Uint8Array(100)).truncated).toBe(true);
  });
});

describe('openArchive', () => {
  it('sniffs magic bytes, not the file name', async () => {
    const zip = zipSync({ 'a.txt': text('x') });
    const opened = await openArchive({ size: zip.length, bytes: async () => zip }, 'wrong.tar.gz');
    expect(opened.format).toBe('zip');
  });

  it('rejects a non-archive', () => {
    expect(() => openArchiveBytes(text('just some text'), 'x.zip')).toThrow(ArchiveError);
  });

  it('refuses a file over the 150 MB cap without reading it', async () => {
    const bytes = jest.fn(async () => new Uint8Array());
    await expect(openArchive({ size: ARCHIVE_MAX_BYTES + 1, bytes })).rejects.toMatchObject({
      code: 'too-large',
    });
    expect(bytes).not.toHaveBeenCalled();
  });

  it('the cap is 150 MB and exactly 150 MB is allowed', () => {
    expect(ARCHIVE_MAX_BYTES).toBe(150 * 1024 * 1024);
    expect(isOverArchiveCap(ARCHIVE_MAX_BYTES)).toBe(false);
    expect(isOverArchiveCap(ARCHIVE_MAX_BYTES + 1)).toBe(true);
    expect(isOverArchiveCap(undefined)).toBe(false);
  });
});
