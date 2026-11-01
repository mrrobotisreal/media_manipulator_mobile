import { track } from '@/analytics/track';
import { deleteResult, type DeleteDeps } from '../deleteJob';

jest.mock('@/analytics/track', () => ({ track: jest.fn() }));

const ctx = { jobId: 'job-1', toolSlug: 'image-converter', mediaKind: 'image' as const };
const deps = (over: Partial<DeleteDeps> = {}) =>
  ({
    remove: jest.fn(async () => ({ deleted: { objects: 2, bytes: 9 }, pending: 0 })),
    evictResult: jest.fn(),
    evictOriginal: jest.fn(),
    removeRecord: jest.fn(),
    invalidate: jest.fn(),
    ...over,
  }) as DeleteDeps & Record<string, jest.Mock>;

beforeEach(() => (track as jest.Mock).mockClear());

describe('deleteResult', () => {
  it('200: evicts caches, drops the record, invalidates tags and emits data_deleted once', async () => {
    const d = deps();
    expect(await deleteResult('job-1', ctx, d)).toEqual({ status: 'deleted', pending: false });
    expect(d.evictResult).toHaveBeenCalledWith('job-1');
    expect(d.evictOriginal).toHaveBeenCalledWith('job-1');
    expect(d.removeRecord).toHaveBeenCalledWith('job-1');
    expect(d.invalidate).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith(
      'data_deleted',
      { scope: 'item', kind: 'result' },
      expect.anything(),
    );
  });

  it('pending > 0 is reported so the UI can say it may take a minute', async () => {
    const d = deps({ remove: jest.fn(async () => ({ pending: 2 })) });
    expect(await deleteResult('job-1', ctx, d)).toEqual({ status: 'deleted', pending: true });
  });

  it('404 counts as already deleted', async () => {
    const d = deps({
      remove: jest.fn(async () => Promise.reject({ status: 404, code: 'not_found', details: {} })),
    });
    expect(await deleteResult('job-1', ctx, d)).toEqual({ status: 'deleted', pending: false });
    expect(d.removeRecord).toHaveBeenCalled();
  });

  it('any other failure keeps everything and emits nothing', async () => {
    const d = deps({
      remove: jest.fn(async () =>
        Promise.reject({ status: 500, code: 'server_error', details: {} }),
      ),
    });
    expect(await deleteResult('job-1', ctx, d)).toEqual({ status: 'failed', httpStatus: 500 });
    expect(d.evictResult).not.toHaveBeenCalled();
    expect(d.removeRecord).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });
});
