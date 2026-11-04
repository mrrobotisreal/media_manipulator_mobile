import { createApi } from '@reduxjs/toolkit/query/react';
import { mmBaseQuery, registerAccountInvalidator } from './baseQuery';

export const mmApi = createApi({
  reducerPath: 'mmApi',
  baseQuery: mmBaseQuery,
  tagTypes: ['Account', 'Tiers', 'History', 'Settings', 'Job', 'PhotoProjects', 'PhotoPresets'],
  // Focus/reconnect refetch is opt-in per endpoint (Account only) to avoid /account/me storms.
  refetchOnFocus: false,
  refetchOnReconnect: false,
  endpoints: () => ({}),
});

registerAccountInvalidator(() => mmApi.util.invalidateTags(['Account']));
