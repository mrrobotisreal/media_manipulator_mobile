import { track } from '@/analytics/track';
import type { MmError } from '@/api/errors';
import {
  apiOrigin,
  fetchResultFile,
  inlineResultUrl,
  resolveLinkUrl,
  ResultFetchError,
  ResultGoneError,
  type FetchResultDeps,
} from '../fetchResult';

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

const link = (over = {}) => ({
  url: '/api/download/job-1?token=abc',
  absoluteUrl: 'https://api.example.test/api/download/job-1?token=abc',
  ...over,
});

function deps(over: Partial<FetchResultDeps> = {}): FetchResultDeps & {
  mintLink: jest.Mock;
  download: jest.Mock;
} {
  return {
    mintLink: jest.fn(async () => link()),
    download: jest.fn(async (_u: string, dest: { uri: string }) => void mockFs.set(dest.uri, 100)),
    ...over,
  } as never;
}

const args = { jobId: 'job-1', fileName: 'out.png', sizeBytes: 100 };
const err = (status: number, code: MmError['code']): MmError => ({ status, code, details: {} });

beforeEach(() => {
  mockFs.clear();
  (track as jest.Mock).mockClear();
});

describe('fetchResultFile', () => {
  it('prefers absoluteUrl and downloads into results/<jobId>/<name>', async () => {
    const d = deps();
    const file = await fetchResultFile(args, d);
    expect(d.mintLink).toHaveBeenCalledWith('job-1');
    expect(d.download.mock.calls[0]![0]).toBe(
      'https://api.example.test/api/download/job-1?token=abc',
    );
    expect(file.uri).toContain('/results/job-1/out.png');
    expect(track).not.toHaveBeenCalled();
  });

  it('falls back to origin + url and records client_error no_absolute_url', async () => {
    const d = deps({ mintLink: jest.fn(async () => link({ absoluteUrl: undefined })) });
    await fetchResultFile(args, d);
    expect(d.download.mock.calls[0]![0]).toBe(`${apiOrigin()}/api/download/job-1?token=abc`);
    expect(track).toHaveBeenCalledWith(
      'client_error',
      expect.objectContaining({ stage: 'download_link', error_type: 'no_absolute_url' }),
    );
  });

  it('reuses a complete cached copy without minting a link', async () => {
    const d = deps();
    await fetchResultFile(args, d);
    d.mintLink.mockClear();
    await fetchResultFile(args, d);
    expect(d.mintLink).not.toHaveBeenCalled();
  });

  it.each([401, 404, 410])('a %s from the link mint is "gone"', async (status) => {
    const d = deps({ mintLink: jest.fn(async () => Promise.reject(err(status, 'not_found'))) });
    await expect(fetchResultFile(args, d)).rejects.toBeInstanceOf(ResultGoneError);
    expect(d.download).not.toHaveBeenCalled();
  });

  it('a 404 from the download is "gone" and leaves no partial file', async () => {
    const d = deps({
      download: jest.fn(async (_u: string, dest: { uri: string }) => {
        mockFs.set(dest.uri, 5);
        throw Object.assign(new Error('x'), { status: 404 });
      }) as never,
    });
    await expect(fetchResultFile(args, d)).rejects.toBeInstanceOf(ResultGoneError);
    expect([...mockFs.keys()].some((k) => k.endsWith('out.png'))).toBe(false);
  });

  it('a network failure is a retryable fetch error, not "gone"', async () => {
    const d = deps({ mintLink: jest.fn(async () => Promise.reject(err(0, 'network'))) });
    await expect(fetchResultFile(args, d)).rejects.toBeInstanceOf(ResultFetchError);
  });
});

describe('helpers', () => {
  it('resolveLinkUrl', () => {
    expect(resolveLinkUrl(link()).usedFallback).toBe(false);
    expect(resolveLinkUrl({ url: 'https://x.test/a' }).url).toBe('https://x.test/a');
  });
  it('inlineResultUrl carries the session id', () => {
    expect(inlineResultUrl('j 1', 's/1')).toMatch(/\/result\/j%201\?sid=s%2F1$/);
  });
});
