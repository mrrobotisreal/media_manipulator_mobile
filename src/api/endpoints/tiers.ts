import { mmApi } from '../mmApi';
import { tiersResponseSchema, type TiersResponse } from '../schemas/tiers';

export const tiersApi = mmApi.injectEndpoints({
  endpoints: (build) => ({
    /** Public matrix; the API sends `Cache-Control: private, max-age=300`. */
    getTiers: build.query<TiersResponse, void>({
      query: () => ({ url: '/tiers', schema: tiersResponseSchema }),
      providesTags: ['Tiers'],
      keepUnusedDataFor: 300,
    }),
  }),
});

export const { useGetTiersQuery } = tiersApi;
