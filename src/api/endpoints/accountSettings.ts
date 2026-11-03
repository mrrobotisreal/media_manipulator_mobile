import { mmApi } from '../mmApi';
import {
  deleteAllSchema,
  deleteReportSchema,
  retentionPreviewSchema,
  revokeSessionsSchema,
  settingsSchema,
  type AccountDeleteReport,
  type AccountSettings,
  type DeleteAllResult,
  type RetentionPreview,
  type RevokeSessionsResult,
  type SettingsPatch,
} from '../schemas/accountSettings';

/** Account settings and destructive data routes (MA22). Shapes: handlers account_settings.go / account_data.go / account_delete.go. */
export const accountSettingsApi = mmApi.injectEndpoints({
  endpoints: (build) => ({
    getSettings: build.query<AccountSettings, void>({
      query: () => ({
        url: '/account/settings',
        schema: settingsSchema,
        skipAccountInvalidation: true,
      }),
      providesTags: ['Settings'],
    }),
    patchSettings: build.mutation<AccountSettings, SettingsPatch>({
      query: (body) => ({
        url: '/account/settings',
        method: 'PATCH',
        body,
        schema: settingsSchema,
        skipAccountInvalidation: true,
      }),
      // A shorter window deletes files now; the History tab must refetch.
      invalidatesTags: ['Settings', 'History'],
    }),
    /** Read-only: what a shorter window would delete. Never cached (a stale count would mislead). */
    previewRetention: build.query<RetentionPreview, number>({
      query: (retentionHours) => ({
        url: '/account/settings/preview',
        params: { retentionHours },
        schema: retentionPreviewSchema,
        skipAccountInvalidation: true,
      }),
      keepUnusedDataFor: 0,
    }),
    deleteAllData: build.mutation<DeleteAllResult, void>({
      query: () => ({
        url: '/account/data/delete-all',
        method: 'POST',
        body: { confirm: 'DELETE' },
        schema: deleteAllSchema,
      }),
      invalidatesTags: ['History', 'Account'],
    }),
    /** 200 report, or an `MmError` whose `details.report` holds the 502 report (resume by calling again). */
    deleteAccount: build.mutation<AccountDeleteReport, void>({
      query: () => ({
        url: '/account',
        method: 'DELETE',
        body: { confirm: 'DELETE MY ACCOUNT' },
        schema: deleteReportSchema,
        skipAccountInvalidation: true,
      }),
    }),
    revokeSessions: build.mutation<RevokeSessionsResult, void>({
      query: () => ({
        url: '/account/sessions/revoke',
        method: 'POST',
        schema: revokeSessionsSchema,
        skipAccountInvalidation: true,
      }),
    }),
  }),
});

export const {
  useGetSettingsQuery,
  usePatchSettingsMutation,
  useLazyPreviewRetentionQuery,
  useDeleteAllDataMutation,
  useDeleteAccountMutation,
  useRevokeSessionsMutation,
} = accountSettingsApi;
