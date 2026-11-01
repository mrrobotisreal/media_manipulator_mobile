import { keepFlow, deleteFlow, type HistoryCache } from '../actions';
import type { HistoryData } from '../cacheOps';

const row = (id: string) => ({ jobId: id, status: 'completed', createdAt: 'x', expired: false });
const mk = (): HistoryData => ({
  pages: [{ entries: [row('a'), row('b')], total: 2 }],
  pageParams: [0],
});

function cacheOf(data: HistoryData): HistoryCache {
  return { update: (recipe) => recipe(data) };
}

describe('keepFlow', () => {
  it('200 updates the row (deletesOn, keptLonger) and sends the hours', async () => {
    const data = mk();
    const keep = jest.fn().mockResolvedValue({ expiresAt: '2026-12-01T00:00:00Z' });
    const out = await keepFlow(row('a') as never, 720, { cache: cacheOf(data), keep });
    expect(keep).toHaveBeenCalledWith('a', 720);
    expect(out).toEqual({ status: 'kept', expiresAt: '2026-12-01T00:00:00Z' });
    expect(data.pages[0]!.entries[0]).toMatchObject({
      deletesOn: '2026-12-01T00:00:00Z',
      keptLonger: true,
    });
  });

  it('409 nothing_to_keep removes the row', async () => {
    const data = mk();
    const keep = jest.fn().mockRejectedValue({ status: 409, code: 'nothing_to_keep' });
    const out = await keepFlow(row('a') as never, 168, { cache: cacheOf(data), keep });
    expect(out).toEqual({ status: 'gone' });
    expect(data.pages[0]!.entries.map((e) => e.jobId)).toEqual(['b']);
    expect(data.pages[0]!.total).toBe(1);
  });

  it('other errors leave the row alone', async () => {
    const data = mk();
    const keep = jest.fn().mockRejectedValue({ status: 503, code: 'server_error' });
    const out = await keepFlow(row('a') as never, 168, { cache: cacheOf(data), keep });
    expect(out).toEqual({ status: 'failed' });
    expect(data.pages[0]!.entries).toHaveLength(2);
  });
});

describe('deleteFlow', () => {
  it('removes the row optimistically and keeps it removed on success', async () => {
    const data = mk();
    let during = -1;
    const remove = jest.fn(async () => {
      during = data.pages[0]!.entries.length;
      return { status: 'deleted' as const, pending: false };
    });
    const out = await deleteFlow(row('a') as never, JSON.parse(JSON.stringify(data)), {
      cache: cacheOf(data),
      remove,
      restore: jest.fn(),
    });
    expect(out).toBe('deleted');
    expect(during).toBe(1);
    expect(data.pages[0]!.entries.map((e) => e.jobId)).toEqual(['b']);
  });

  it('restores the page on failure', async () => {
    const data = mk();
    const snapshot = JSON.parse(JSON.stringify(data));
    const out = await deleteFlow(row('a') as never, snapshot, {
      cache: cacheOf(data),
      remove: async () => ({ status: 'failed' as const }),
      restore: jest.fn(),
    });
    expect(out).toBe('failed');
    expect(data.pages[0]!.entries.map((e) => e.jobId)).toEqual(['a', 'b']);
  });

  it('reports pending deletes', async () => {
    const out = await deleteFlow(row('a') as never, undefined, {
      cache: cacheOf(mk()),
      remove: async () => ({ status: 'deleted' as const, pending: true }),
      restore: jest.fn(),
    });
    expect(out).toBe('pending');
  });
});
