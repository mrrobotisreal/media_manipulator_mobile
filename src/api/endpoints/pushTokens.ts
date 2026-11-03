import { mmApi } from '../mmApi';

export interface PushTokenBody {
  token: string;
  platform: 'ios' | 'android';
  appVersion: string;
  locale: string;
}

/**
 * `POST|DELETE /api/account/push-tokens` (MA23, handlers push_tokens.go): both answer 204. Errors:
 * 409 `account_not_synced`, 503 `push_unavailable`, 400 `invalid_*`. The token travels in the body only;
 * nothing here logs, tracks or caches it (no schema, no tags).
 */
export const pushTokensApi = mmApi.injectEndpoints({
  endpoints: (build) => ({
    registerPushToken: build.mutation<null, PushTokenBody>({
      query: (body) => ({
        url: '/account/push-tokens',
        method: 'POST',
        body,
        skipAccountInvalidation: true,
      }),
    }),
    unregisterPushToken: build.mutation<null, { token: string }>({
      query: (body) => ({
        url: '/account/push-tokens',
        method: 'DELETE',
        body,
        skipAccountInvalidation: true,
      }),
    }),
  }),
});
