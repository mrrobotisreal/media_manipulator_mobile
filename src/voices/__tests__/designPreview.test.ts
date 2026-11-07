import { base64Bytes, PREVIEW_DIR, clearPreviews, writePreviewFile } from '../designPreview';

const written: { path: string; data: string; opts: unknown }[] = [];
const deleted: string[] = [];
jest.mock('expo-file-system', () => {
  class Directory {
    uri: string;
    exists = true;
    constructor(...parts: unknown[]) {
      this.uri = parts
        .map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri))
        .join('/');
    }
    create() {}
    delete() {
      deleted.push(this.uri);
    }
  }
  class File {
    uri: string;
    constructor(dir: { uri: string }, name: string) {
      this.uri = `${dir.uri}/${name}`;
    }
    write(data: string, opts: unknown) {
      written.push({ path: this.uri, data, opts });
    }
  }
  return { Directory, File, Paths: { cache: { uri: 'file:///cache' } } };
});

beforeEach(() => {
  written.length = 0;
  deleted.length = 0;
});

describe('design preview (MA34 decision 6)', () => {
  it('writes the inline base64 MP3 to a cache file named by the seed and returns its uri', () => {
    const uri = writePreviewFile('SUQzBAAAAAAA', 123456);
    expect(uri).toBe(`file:///cache/${PREVIEW_DIR}/design-123456.mp3`);
    expect(written).toEqual([{ path: uri, data: 'SUQzBAAAAAAA', opts: { encoding: 'base64' } }]);
  });

  it('a second preview (Try another) is a different file; the seed names the one that was heard', () => {
    const a = writePreviewFile('QUFB', 1);
    const b = writePreviewFile('QkJC', 2);
    expect(a).not.toBe(b);
  });

  it('clears the preview directory when the screen closes', () => {
    clearPreviews();
    expect(deleted).toEqual([`file:///cache/${PREVIEW_DIR}`]);
  });

  it('counts the decoded bytes of a base64 string', () => {
    expect(base64Bytes('QUFB')).toBe(3);
    expect(base64Bytes('QQ==')).toBe(1);
  });
});
