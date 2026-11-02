import { mmApi } from '../mmApi';
import {
  analysisResultSchema,
  transcribeResultSchema,
  type AnalysisResult,
  type TranscribeResult,
} from '../schemas/transcript';

/** Polling cap for the analysis (MA20 proposed): 4 s steps for 5 minutes. */
export const ANALYSIS_POLL_MS = 4000;
export const ANALYSIS_MAX_MS = 5 * 60 * 1000;

export const transcriptApi = mmApi.injectEndpoints({
  endpoints: (build) => ({
    /** `GET /api/transcript/:jobId`; 404 = not available (surfaced as `not_found`). */
    getTranscript: build.query<TranscribeResult, string>({
      query: (jobId) => ({
        url: `/transcript/${encodeURIComponent(jobId)}`,
        schema: transcribeResultSchema,
        skipAccountInvalidation: true,
      }),
      keepUnusedDataFor: 300,
    }),
    /** `GET /api/analysis/:jobId`; 404 = still running (the viewer polls). */
    getAnalysis: build.query<AnalysisResult, string>({
      query: (jobId) => ({
        url: `/analysis/${encodeURIComponent(jobId)}`,
        schema: analysisResultSchema,
        skipAccountInvalidation: true,
      }),
      keepUnusedDataFor: 300,
    }),
  }),
});

export const { useGetTranscriptQuery, useGetAnalysisQuery } = transcriptApi;
