/** Single source of the API origin (ADR MA-0005 §5). No other URL is hard-coded. */
export const DEFAULT_API_BASE_URL = 'https://api.media-manipulator.com/api';

export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(
  /\/+$/,
  '',
);

/** Default timeout for JSON calls (uploads, SSE and downloads manage their own). */
export const JSON_TIMEOUT_MS = 30_000;
