import { track } from '@/analytics/track';
import type { MmError } from '@/api/errors';
import type { FetchResultDeps } from '@/results/fetchResult';
import { downloadResult } from '../download';

jest.mock('@/analytics/track', () => ({ track: jest.fn() }));

const mockFs = new Map<string, number>();
jest.mock('expo-file-system', () => {
  const join = (...parts: unknown[]) =>
    parts
      .map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri))
      .join('/')
      .replace(/^file:\/+/, 'file:///')
      .replace(/([^:/])\/+/g, '$1/');
  class Directory {
    uri: string;
    constructor(...p: unknown[]) {
      this.uri = join(...p);
    }
    get exists() {
      return mockFs.has(this.uri);
    }
    create() {
      mockFs.set(this.uri, 0);
    }
    delete() {}
  }
  class File {
    uri: string;
    constructor(...p: unknown[]) {
      this.uri = join(...p);
    }
    get exists() {
      return mockFs.has(this.uri);
    }
    get size() {
      return mockFs.get(this.uri) ?? 0;
    }
    delete() {
      mockFs.delete(this.uri);
    }
  }
  return { Directory, File, Paths: { cache: new Directory('file:///cache') } };
});

const link = (token = 'abc') => ({
  url: `/api/download/job-1?token=${token}`,
  absoluteUrl: `https://api.example.test/api/download/job-1?token=${token}`,
});
const ctx = { jobId: 'job-1', toolSlug: 'image-converter', mediaKind: 'image' as const };
const base = {
  jobId: 'job-1',
  fileName: 'out.png',
  sizeBytes: 100,
  outputFormat: 'png',
  context: ctx,
};

function deps(over: Partial<FetchResultDeps> = {}) {
  let n = 0;
  return {
    mintLink: jest.fn(async () => link(`t${++n}`)),
    download: jest.fn(
      async (_u: string, dest: { uri: string }, o: { onProgress?: (f: number) => void }) => {
        o.onProgress?.(0.5);
        mockFs.set(dest.uri, 100);
      },
    ),
    ...over,
  } as unknown as FetchResultDeps & { mintLink: jest.Mock; download: jest.Mock };
}

const names = () => (track as jest.Mock).mock.calls.map((c) => c[0]);

beforeEach(() => {
  mockFs.clear();
  (track as jest.Mock).mockClear();
});

describe('downloadResult', () => {
  it('downloads from absoluteUrl, reports progress and emits started + completed', async () => {
    const d = deps();
    const onProgress = jest.fn();
    let t = 1000;
    const file = await downloadResult({ ...base, deps: d, onProgress, now: () => (t += 50) });
    expect(d.download.mock.calls[0]![0]).toBe(
      'https://api.example.test/api/download/job-1?token=t1',
    );
    expect(onProgress).toHaveBeenCalledWith(0.5);
    expect(file.uri).toContain('/results/job-1/out.png');
    expect(names()).toEqual(['download_started', 'download_completed']);
    expect((track as jest.Mock).mock.calls[1]![1]).toEqual({
      job_id: 'job-1',
      output_format: 'png',
      size_bytes: 100,
      duration_ms: 50,
    });
  });

  it('serves a cached copy without the network and without download_started', async () => {
    const d = deps();
    await downloadResult({ ...base, deps: d });
    (track as jest.Mock).mockClear();
    d.mintLink.mockClear();
    await downloadResult({ ...base, deps: d });
    expect(d.mintLink).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });

  it('mints a fresh link for every network download', async () => {
    const d = deps();
    await downloadResult({ ...base, deps: d });
    mockFs.clear();
    await downloadResult({ ...base, deps: d });
    expect(d.mintLink).toHaveBeenCalledTimes(2);
    expect(d.download.mock.calls[0]![0]).not.toBe(d.download.mock.calls[1]![0]);
  });

  it('uses a pre-minted link (MP3 variant) instead of the plain mint', async () => {
    const d = deps();
    await downloadResult({
      ...base,
      fileName: 'song.mp3',
      outputFormat: 'mp3',
      link: link('mp3'),
      deps: d,
    });
    expect(d.download.mock.calls[0]![0]).toContain('token=mp3');
  });

  it('a 404 is "gone": download_failed with status 404 and no file', async () => {
    const err: MmError = { status: 404, code: 'not_found', details: {} };
    const d = deps({ mintLink: jest.fn(async () => Promise.reject(err)) } as never);
    await expect(downloadResult({ ...base, deps: d })).rejects.toThrow('result_gone');
    expect(track).toHaveBeenLastCalledWith(
      'download_failed',
      { job_id: 'job-1', reason: 'gone', status: 404 },
      expect.anything(),
    );
  });

  it('a network failure reports reason network', async () => {
    const err: MmError = { status: 'FETCH_ERROR', code: 'network', details: {} };
    const d = deps({ mintLink: jest.fn(async () => Promise.reject(err)) } as never);
    await expect(downloadResult({ ...base, deps: d })).rejects.toThrow('result_fetch_network');
    expect((track as jest.Mock).mock.calls.at(-1)![1]).toMatchObject({ reason: 'network' });
  });

  it('cancel emits no download_failed', async () => {
    const abort = new AbortController();
    const d = deps({
      download: jest.fn(async () => {
        abort.abort();
        throw new Error('AbortError');
      }),
    } as never);
    await expect(downloadResult({ ...base, deps: d, signal: abort.signal })).rejects.toThrow();
    expect(names()).toEqual(['download_started']);
  });

  it('two callers for the same file share one transfer', async () => {
    const d = deps();
    const [a, b] = await Promise.all([
      downloadResult({ ...base, deps: d }),
      downloadResult({ ...base, deps: d }),
    ]);
    expect(d.download).toHaveBeenCalledTimes(1);
    expect(a.uri).toBe(b.uri);
  });
});
