import { mmApi } from '../mmApi';
import {
  conversionJobSchema,
  downloadLinkSchema,
  type ConversionJob,
  type DownloadLink,
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
