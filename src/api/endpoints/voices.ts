/**
 * `/api/voices/*` (ticket MA34 decision 2; handlers/voices.go, web `lib/voices/voicesApi.ts`) on the one
 * RTK Query API. The synchronous multipart `POST /voices` (clone) is a native upload task, not an RTK
 * endpoint (`createVoice` below, the `detectFaces` pattern). Jobs (speak, convert, shift) start through the
 * job engine's starters (`src/jobs/starters/voices.ts`).
 *
 * Errors keep the server's snake_case `error` in `MmError.code` (`api:<code>`); `voiceErrorText`
 * (`src/voices/errors.ts`) turns it into the synced web copy.
 */
import type { z } from 'zod';
import { buildHeaders as realBuildHeaders, headerBag, parseQuota } from '../baseQuery';
import { API_BASE_URL } from '../config';
import { contractMismatch, networkError, normaliseError, type MmError } from '../errors';
import { mmApi } from '../mmApi';
import {
  designPreviewSchema,
  savedVoiceSchema,
  voiceDeletedSchema,
  voiceJobStartSchema,
  voicesCapabilitiesSchema,
  voicesListSchema,
  type DesignInput,
  type DesignPreview,
  type SavedVoice,
  type SpeakInput,
  type VoiceDeleted,
  type VoiceJobStart,
  type VoicesCapabilities,
  type VoicesList,
} from '../schemas/voices';

const enc = encodeURIComponent;

/** Design previews and saves render a voice on the GPU; allow the server's own ceiling (~60 s). */
const SLOW_MS = 90_000;

export const voicesApi = mmApi.injectEndpoints({
  endpoints: (build) => ({
    /** Always 200 (also `enabled:false`); `Cache-Control: private, max-age=10`, refetched on focus. */
    getVoicesCapabilities: build.query<VoicesCapabilities, void>({
      query: () => ({
        url: '/voices/capabilities',
        schema: voicesCapabilitiesSchema,
        skipAccountInvalidation: true,
      }),
      keepUnusedDataFor: 30,
    }),
    listVoices: build.query<VoicesList, void>({
      query: () => ({
        url: '/voices',
        schema: voicesListSchema,
        skipAccountInvalidation: true,
      }),
      providesTags: ['Voices'],
    }),
    renameVoice: build.mutation<SavedVoice, { id: string; name: string }>({
      query: ({ id, name }) => ({
        url: `/voices/${enc(id)}`,
        method: 'PATCH',
        body: { name },
        schema: savedVoiceSchema,
        skipAccountInvalidation: true,
      }),
      invalidatesTags: ['Voices'],
    }),
    deleteVoice: build.mutation<VoiceDeleted, string>({
      query: (id) => ({
        url: `/voices/${enc(id)}`,
        method: 'DELETE',
        schema: voiceDeletedSchema,
        skipAccountInvalidation: true,
      }),
      invalidatesTags: ['Voices'],
    }),
    /** Uncounted; 3 per description per hour (`preview_limit`). */
    previewDesign: build.mutation<DesignPreview, DesignInput>({
      query: (body) => ({
        url: '/voices/design/preview',
        method: 'POST',
        body,
        schema: designPreviewSchema,
        timeoutMs: SLOW_MS,
        skipAccountInvalidation: true,
      }),
    }),
    /** Synchronous 201, one `ai_ops` (the baseQuery feeds the quota headers). */
    designVoice: build.mutation<SavedVoice, DesignInput & { name: string }>({
      query: (body) => ({
        url: '/voices/design',
        method: 'POST',
        body,
        schema: savedVoiceSchema,
        timeoutMs: SLOW_MS,
      }),
      invalidatesTags: ['Voices'],
    }),
    /** `POST /voices/:id/speak` -> 202 `{jobId, tool:'voice_tts'}` (one `ai_ops`). Sign-in required. */
    speakVoice: build.mutation<VoiceJobStart, { voiceId: string; body: SpeakInput }>({
      query: ({ voiceId, body }) => ({
        url: `/voices/${enc(voiceId)}/speak`,
        method: 'POST',
        body,
        schema: voiceJobStartSchema,
      }),
    }),
    /** `POST /voices/presets/:preset/speak` -> 202 (anonymous allowed; no exaggeration). */
    speakPreset: build.mutation<
      VoiceJobStart,
      { preset: string; body: Omit<SpeakInput, 'exaggeration'> }
    >({
      query: ({ preset, body }) => ({
        url: `/voices/presets/${enc(preset)}/speak`,
        method: 'POST',
        body,
        schema: voiceJobStartSchema,
      }),
    }),
  }),
});

export const {
  useGetVoicesCapabilitiesQuery,
  useListVoicesQuery,
  useRenameVoiceMutation,
  useDeleteVoiceMutation,
  usePreviewDesignMutation,
  useDesignVoiceMutation,
} = voicesApi;

// --- multipart posts (clone, convert, shift) ---------------------------------------------------

export type MultipartResult<T> = { ok: true; data: T } | { ok: false; error: MmError };
export type CreateVoiceResult = { ok: true; voice: SavedVoice } | { ok: false; error: MmError };

/** The slice of an expo-file-system UploadTask these calls use (jest injects a fake). */
export interface MultipartTask {
  uploadAsync(): Promise<{ status: number; headers: Record<string, string>; body: string }>;
  cancel(): void;
}
export type CreateVoiceTask = MultipartTask;

export interface MultipartDeps {
  makeTask(
    uri: string,
    url: string,
    opts: {
      headers: Record<string, string>;
      fieldName: string;
      mimeType: string;
      parameters: Record<string, string>;
      signal: AbortSignal;
    },
  ): MultipartTask;
  buildHeaders?: typeof realBuildHeaders;
  baseUrl?: string;
  /** Quota headers of a 2xx (the counted units) and a refreshed Account on any other answer. */
  onResponse?: (status: number, headers: Record<string, string>) => void;
}
export type CreateVoiceDeps = MultipartDeps;

function parseJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

/** One multipart POST under `/voices`: a single file part plus string parameters, answer parsed by `schema`. */
export async function postVoicesMultipart<T>(
  path: string,
  file: { uri: string; mimeType: string; fieldName: string },
  parameters: Record<string, string>,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  deps: MultipartDeps,
  signal: AbortSignal = new AbortController().signal,
): Promise<MultipartResult<T>> {
  const headersFor = deps.buildHeaders ?? realBuildHeaders;
  const url = `${deps.baseUrl ?? API_BASE_URL}/voices${path}`;
  try {
    const headers = await headersFor({});
    if (signal.aborted) return { ok: false, error: networkError('cancelled') };
    const task = deps.makeTask(file.uri, url, {
      headers,
      fieldName: file.fieldName,
      mimeType: file.mimeType,
      parameters,
      signal,
    });
    const onAbort = () => task.cancel();
    signal.addEventListener('abort', onAbort);
    let res;
    try {
      res = await task.uploadAsync();
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
    deps.onResponse?.(res.status, res.headers);
    const body = parseJson(res.body);
    if (res.status >= 200 && res.status < 300) {
      const parsed = schema.safeParse(body);
      if (parsed.success) return { ok: true, data: parsed.data };
      const issues = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || '(root)'))];
      return { ok: false, error: contractMismatch(`voices${path}`, issues) };
    }
    return { ok: false, error: normaliseError(res.status, body, headerBag(res.headers)) };
  } catch (e) {
    return { ok: false, error: networkError(e instanceof Error ? e.message : undefined) };
  }
}

export interface CreateVoiceInput {
  /** The reference recording (`file://`, the cached sample). Sent as part `reference`. */
  file: { uri: string; mimeType: string };
  name: string;
  languageHint: string;
  /** Literally `true`: the consent gate keeps Create disabled until the box is ticked. */
  consent: true;
  consentTextVersion: string;
}

/** The text parameters of `POST /voices` (the clone multipart, beside the `reference` file part). */
export function createVoiceParameters(input: CreateVoiceInput): Record<string, string> {
  return {
    name: input.name,
    languageHint: input.languageHint,
    consent: input.consent ? 'true' : 'false',
    consentTextVersion: input.consentTextVersion,
  };
}

/**
 * `POST /api/voices`, multipart parts `reference` (file) + `name`, `languageHint`, `consent`
 * (`"true"`), `consentTextVersion`. Synchronous: 201 with the saved voice after the 6-language preview is
 * rendered (up to ~60 s, one `ai_ops`). The server stores its own `VOICES_CONSENT_TEXT_VERSION`; the
 * version the app showed rides along so a mismatch is visible in request logs (web precedent).
 */
export async function createVoice(
  input: CreateVoiceInput,
  deps: MultipartDeps,
  signal?: AbortSignal,
): Promise<CreateVoiceResult> {
  const r: MultipartResult<SavedVoice> = await postVoicesMultipart(
    '',
    { ...input.file, fieldName: 'reference' },
    createVoiceParameters(input),
    savedVoiceSchema,
    deps,
    signal,
  );
  return r.ok ? { ok: true, voice: r.data } : r;
}

/** Real bindings (expo-file-system multipart task + the quota/Account bookkeeping). Lazy requires keep jest light. */
export function realMultipartDeps(): MultipartDeps {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { File, UploadType } = require('expo-file-system') as typeof import('expo-file-system');
  const { store } = require('@/state/store') as typeof import('@/state/store');
  const { observed } = require('@/state/slices/quota') as typeof import('@/state/slices/quota');
  /* eslint-enable @typescript-eslint/no-require-imports */
  return {
    makeTask: (uri, url, o) =>
      new File(uri).createUploadTask(url, {
        httpMethod: 'POST',
        uploadType: UploadType.MULTIPART,
        headers: o.headers,
        fieldName: o.fieldName,
        mimeType: o.mimeType,
        parameters: o.parameters,
        sessionType: 'foreground',
        signal: o.signal,
      }),
    onResponse: (status, headers) => {
      if ((status >= 200 && status < 300) || status === 429) {
        const q = parseQuota(headerBag(headers));
        if (q) store.dispatch(observed(q));
      }
      if (status < 200 || status >= 300) store.dispatch(mmApi.util.invalidateTags(['Account']));
      else store.dispatch(mmApi.util.invalidateTags(['Voices']));
    },
  };
}
export const realCreateVoiceDeps = realMultipartDeps;
