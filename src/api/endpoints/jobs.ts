import { mmApi } from '../mmApi';
import {
  conversionJobSchema,
  createdShareSchema,
  deletedJobSchema,
  downloadLinkSchema,
  mp3StatusSchema,
  revokedSharesSchema,
  type ConversionJob,
  type CreatedShare,
  type DeletedJob,
  type DownloadLink,
  type Mp3Status,
} from '../schemas/job';
import {
  uploadResponseSchema,
  videoUploadTargetSchema,
  type CompleteRequest,
  type PresignRequest,
  type UploadResponse,
  type VideoUploadTarget,
} from '../schemas/upload';

export const jobsApi = mmApi.injectEndpoints({
  endpoints: (build) => ({
    /** `GET /job/:id`. Owner headers come from `buildHeaders()` (MA08). A 404 must not refetch Account. */
    getJob: build.query<ConversionJob, string>({
      query: (jobId) => ({
        url: `/job/${encodeURIComponent(jobId)}`,
        schema: conversionJobSchema,
        skipAccountInvalidation: true,
      }),
      providesTags: (_r, _e, jobId) => [{ type: 'Job', id: jobId }],
      keepUnusedDataFor: 1,
    }),
    /**
     * `POST /download/:jobId/link`: a fresh 300 s signed URL per download (never cached). Owner headers
     * come from `buildHeaders()`; the minted token is the only credential the download itself needs.
     */
    createDownloadLink: build.mutation<DownloadLink, string>({
      query: (jobId) => ({
        url: `/download/${encodeURIComponent(jobId)}/link`,
        method: 'POST',
        schema: downloadLinkSchema,
        skipAccountInvalidation: true,
      }),
    }),
    /** `POST /download/:jobId/mp3` (MM81): starts (or joins) the WAV -> MP3 transcode. 202 processing / 200 ready. */
    startMp3: build.mutation<Mp3Status, string>({
      query: (jobId) => ({
        url: `/download/${encodeURIComponent(jobId)}/mp3`,
        method: 'POST',
        body: {},
        schema: mp3StatusSchema,
        skipAccountInvalidation: true,
      }),
    }),
    /** `GET /download/:jobId/mp3`: poll target (a mutation so nothing is cached between polls). */
    pollMp3: build.mutation<Mp3Status, string>({
      query: (jobId) => ({
        url: `/download/${encodeURIComponent(jobId)}/mp3`,
        schema: mp3StatusSchema,
        skipAccountInvalidation: true,
      }),
    }),
    /** `POST /jobs/:jobId/share` (MM32): every call mints a new public link (not idempotent). */
    createShare: build.mutation<CreatedShare, string>({
      query: (jobId) => ({
        url: `/jobs/${encodeURIComponent(jobId)}/share`,
        method: 'POST',
        body: {},
        schema: createdShareSchema,
        skipAccountInvalidation: true,
      }),
    }),
    /** `DELETE /jobs/:jobId/share`: revokes every live link of the job. */
    revokeShares: build.mutation<{ revoked?: number }, string>({
      query: (jobId) => ({
        url: `/jobs/${encodeURIComponent(jobId)}/share`,
        method: 'DELETE',
        schema: revokedSharesSchema,
        skipAccountInvalidation: true,
      }),
    }),
    /** `DELETE /jobs/:jobId`: removes the result everywhere. Tag invalidation is done by the caller. */
    deleteJob: build.mutation<DeletedJob, string>({
      query: (jobId) => ({
        url: `/jobs/${encodeURIComponent(jobId)}`,
        method: 'DELETE',
        schema: deletedJobSchema,
        skipAccountInvalidation: true,
      }),
    }),
    /** `POST /video-upload/presign` (201). Non-2xx invalidates Account like every mutation. */
    presignVideoUpload: build.mutation<VideoUploadTarget, PresignRequest>({
      query: (body) => ({
        url: '/video-upload/presign',
        method: 'POST',
        body,
        schema: videoUploadTargetSchema,
      }),
    }),
    /** `POST /video-upload/complete`: quota is spent here. The token is read fresh per request. */
    completeVideoUpload: build.mutation<UploadResponse, CompleteRequest>({
      query: (body) => ({
        url: '/video-upload/complete',
        method: 'POST',
        body,
        schema: uploadResponseSchema,
        timeoutMs: 120_000,
      }),
    }),
  }),
});

export const { useGetJobQuery, useCreateDownloadLinkMutation } = jobsApi;
