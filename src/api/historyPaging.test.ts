import { HISTORY_PAGE_SIZE, historyApi, nextHistoryOffset } from './endpoints/history';
import { setIdTokenProvider } from './authToken';
import { makeReadyStore } from '@/state/testing';
import { flattenHistory, type HistoryData } from '@/history/cacheOps';

const row = (id: string) => ({ jobId: id, status: 'completed', createdAt: '2026-11-01T10:00:00Z' });
const page = (ids: string[], total: number, offset: number) => ({
  entries: ids.map(row),
  total,
  limit: 50,
  offset,
});

describe('nextHistoryOffset', () => {
  it('continues until total, stops at total and on an empty page', () => {
    expect(nextHistoryOffset(page(['a', 'b'], 5, 0) as never, 0)).toBe(2);
    expect(nextHistoryOffset(page(['e'], 5, 4) as never, 4)).toBeUndefined();
    expect(nextHistoryOffset(page([], 5, 2) as never, 2)).toBeUndefined();
  });
});

describe('getHistory infinite query', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  function mockServer(rows: string[], calls: string[]) {
    global.fetch = jest.fn((url: string) => {
      calls.push(url);
      const u = new URL(url);
      const offset = Number(u.searchParams.get('offset'));
      const limit = Number(u.searchParams.get('limit'));
      const body = page(rows.slice(offset, offset + limit), rows.length, offset);
      return Promise.resolve({
        status: 200,
        headers: new Headers(),
        text: () => Promise.resolve(JSON.stringify(body)),
      });
    }) as unknown as typeof fetch;
  }

  it('asks for limit=50, merges pages by offset, de-duplicates, stops at total and refresh resets', async () => {
    setIdTokenProvider(() => Promise.resolve(null));
    const { store } = await makeReadyStore();
    const rows = Array.from({ length: 120 }, (_, i) => `j${i}`);
    const calls: string[] = [];
    mockServer(rows, calls);

    const sub = store.dispatch(historyApi.endpoints.getHistory.initiate(undefined));
    await sub;
    expect(calls[0]).toContain(`limit=${HISTORY_PAGE_SIZE}`);
    expect(calls[0]).toContain('offset=0');

    await store.dispatch(
      historyApi.endpoints.getHistory.initiate(undefined, { direction: 'forward' }),
    );
    await store.dispatch(
      historyApi.endpoints.getHistory.initiate(undefined, { direction: 'forward' }),
    );
    let data = historyApi.endpoints.getHistory.select(undefined)(store.getState())
      .data as HistoryData;
    expect(data.pages).toHaveLength(3);
    expect(flattenHistory(data)).toHaveLength(120);
    expect(calls.map((c) => new URL(c).searchParams.get('offset'))).toEqual(['0', '50', '100']);

    // At the end: no further fetch is possible.
    const before = calls.length;
    await store.dispatch(
      historyApi.endpoints.getHistory.initiate(undefined, { direction: 'forward' }),
    );
    expect(calls.length).toBe(before);

    // Refresh = page 0 only.
    await store.dispatch(
      historyApi.endpoints.getHistory.initiate(undefined, {
        forceRefetch: true,
        refetchCachedPages: false,
      }),
    );
    data = historyApi.endpoints.getHistory.select(undefined)(store.getState()).data as HistoryData;
    expect(data.pages).toHaveLength(1);
    sub.unsubscribe();
  });

  it('flattenHistory de-duplicates a row that shifted between pages', () => {
    const data = { pages: [page(['a', 'b'], 4, 0), page(['b', 'c'], 4, 2)], pageParams: [0, 2] };
    expect(flattenHistory(data as never).map((e) => e.jobId)).toEqual(['a', 'b', 'c']);
  });
});
