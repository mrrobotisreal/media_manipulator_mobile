import { mmApi } from '../mmApi';
import { usageResponseSchema, type SyncRequest, type UsageResponse } from '../schemas/account';

export const accountApi = mmApi.injectEndpoints({
  endpoints: (build) => ({
    getAccountMe: build.query<UsageResponse, void>({
      query: () => ({
        url: '/account/me',
        schema: usageResponseSchema,
        skipAccountInvalidation: true,
      }),
      providesTags: ['Account'],
    }),
    getAccountUsage: build.query<UsageResponse, void>({
      query: () => ({
        url: '/account/usage',
        schema: usageResponseSchema,
        skipAccountInvalidation: true,
      }),
      providesTags: ['Account'],
    }),
    /** Idempotent post-sign-in sync; returns the same shape as /account/me. */
    syncAccount: build.mutation<UsageResponse, SyncRequest | void>({
      query: (body) => ({
        url: '/account/sync',
        method: 'POST',
        body: body ?? {},
        schema: usageResponseSchema,
      }),
      invalidatesTags: ['Account'],
    }),
  }),
});

export const { useGetAccountMeQuery, useGetAccountUsageQuery, useSyncAccountMutation } = accountApi;
