import { mmApi } from '../mmApi';
import {
  historyResponseSchema,
  keepLongerResponseSchema,
  type HistoryPage,
  type KeepLongerResponse,
} from '../schemas/history';

/** The server maximum (`historyMaxLimit`): fewest round trips. */
export const HISTORY_PAGE_SIZE = 50;

/** Next `offset`, or undefined once every row is loaded (or a page came back empty). */
export function nextHistoryOffset(lastPage: HistoryPage, lastOffset: number): number | undefined {
  const next = lastOffset + lastPage.entries.length;
  return lastPage.entries.length > 0 && next < lastPage.total ? next : undefined;
}

export const historyApi = mmApi.injectEndpoints({
  endpoints: (build) => ({
    /**
     * Infinite query (RTK Query >= 2.6 `build.infiniteQuery`): the page param is the `offset`. Refetching
     * (tag invalidation) re-reads every cached page in order; a pull-to-refresh passes
     * `refetchCachedPages: false` to reset to page 0.
     */
    getHistory: build.infiniteQuery<HistoryPage, void, number>({
      infiniteQueryOptions: {
        initialPageParam: 0,
        getNextPageParam: (lastPage, _all, lastOffset) => nextHistoryOffset(lastPage, lastOffset),
      },
      query: ({ pageParam }) => ({
        url: '/account/history',
        params: { limit: HISTORY_PAGE_SIZE, offset: pageParam },
        schema: historyResponseSchema,
        skipAccountInvalidation: true,
      }),
      providesTags: ['History'],
    }),
    /** `PATCH /jobs/:jobId/retention`. 409 `nothing_to_keep` = the result is already gone. */
    keepJobLonger: build.mutation<KeepLongerResponse, { jobId: string; keepForHours: number }>({
      query: ({ jobId, keepForHours }) => ({
        url: `/jobs/${encodeURIComponent(jobId)}/retention`,
        method: 'PATCH',
        body: { keepForHours },
        schema: keepLongerResponseSchema,
        skipAccountInvalidation: true,
      }),
    }),
  }),
});

export const { useGetHistoryInfiniteQuery, useKeepJobLongerMutation } = historyApi;
