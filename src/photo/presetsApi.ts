/**
 * Aperture account presets (ticket MA53 decision 1) on the one RTK Query API. Routes, bodies and
 * errors are MM103's (`media_manipulator_api/internal/handlers/photo_presets.go`):
 *
 *   GET    /photo/presets?full=1         {presets:[{id,name,category,revision,hasThumbnail,thumbnailUrl?,layers?,...}], limit, used}
 *   POST   /photo/presets                {name, category?, layers} → 201; 403 photo_presets_limit {limit, used, upgradePath}
 *   GET    /photo/presets/:id            the preset with layers
 *   PUT    /photo/presets/:id            If-Match: <revision>; {name?, category?, layers?}; 409 revision_conflict {revision}
 *   DELETE /photo/presets/:id            soft delete
 *   POST   /photo/presets/:id/thumbnail  multipart `file` (PNG ≤ 64 KB, ≤ 256 px)
 *
 * Signed-in only (the app always is). `layers` is parsed with the shared `layerSchema`: a layer this
 * build cannot read is dropped (the web's `presetOf` rule), so one newer layer type never hides the
 * whole preset. The thumbnail is a native multipart upload (expo-file-system), not JSON.
 */
import { mmApi } from '@/api/mmApi';
import { buildHeaders, headerBag, parseQuota } from '@/api/baseQuery';
import { API_BASE_URL } from '@/api/config';
import { networkError, normaliseError, type MmError } from '@/api/errors';
import { photoPresetListSchema, photoPresetSchema, type PhotoPresetRow } from '@/api/schemas/photo';
import { observed } from '@/state/slices/quota';
import { layerSchema, type AdjustmentLayer } from './photoTypes';
import {
  USER_PRESET_CATEGORIES,
  USER_PRESET_NAME_MAX,
  type UserPreset,
  type UserPresetCategoryId,
} from './presets/userStore';

const enc = encodeURIComponent;

/** A preset on the account (MM103 `photo_presets`). */
export interface AccountPreset {
  id: string;
  name: string;
  category: UserPresetCategoryId | null;
  revision: number;
  hasThumbnail: boolean;
  layers: AdjustmentLayer[];
  createdAt: string;
  updatedAt: string;
}

export interface AccountPresetList {
  presets: AccountPreset[];
  /** The tier cap: -1 unlimited, 0 none. */
  limit: number;
  used: number;
}

export function accountPresetOf(row: PhotoPresetRow): AccountPreset {
  const category = (USER_PRESET_CATEGORIES as readonly unknown[]).includes(row.category)
    ? (row.category as UserPresetCategoryId)
    : null;
  const layers: AdjustmentLayer[] = [];
  if (Array.isArray(row.layers)) {
    for (const l of row.layers) {
      const p = layerSchema.safeParse(l);
      if (p.success) layers.push(p.data as AdjustmentLayer);
    }
  }
  return {
    id: row.id,
    name: row.name,
    category,
    revision: row.revision,
    hasThumbnail: row.hasThumbnail === true,
    layers,
    createdAt: row.createdAt ?? '',
    updatedAt: row.updatedAt ?? '',
  };
}

/** The `aperture-presets` export record of an account preset (JSON export works on either store). */
export const asUserPreset = (p: AccountPreset): UserPreset => ({
  id: p.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'preset',
  name: p.name,
  category: p.category,
  layers: p.layers,
  createdAt: p.createdAt || new Date(0).toISOString(),
});

const clampName = (name: string) => name.trim().slice(0, USER_PRESET_NAME_MAX);

export const presetsApi = mmApi.injectEndpoints({
  endpoints: (build) => ({
    /** The account's presets with layers, newest first. Kept an hour (decision 4: offline reopen). */
    listPhotoPresets: build.query<AccountPresetList, void>({
      query: () => ({
        url: '/photo/presets',
        params: { full: 1 },
        schema: photoPresetListSchema,
        skipAccountInvalidation: true,
      }),
      transformResponse: (r: { presets: PhotoPresetRow[]; limit: number; used?: number }) => {
        const presets = r.presets.map(accountPresetOf);
        return { presets, limit: r.limit, used: r.used ?? presets.length };
      },
      providesTags: ['PhotoPresets'],
      keepUnusedDataFor: 3600,
    }),
    getPhotoPreset: build.query<AccountPreset, string>({
      query: (id) => ({
        url: `/photo/presets/${enc(id)}`,
        schema: photoPresetSchema,
        skipAccountInvalidation: true,
      }),
      transformResponse: (r: PhotoPresetRow) => accountPresetOf(r),
      providesTags: ['PhotoPresets'],
    }),
    createPhotoPreset: build.mutation<
      AccountPreset,
      { name: string; category?: UserPresetCategoryId | null; layers: AdjustmentLayer[] }
    >({
      query: ({ name, category, layers }) => ({
        url: '/photo/presets',
        method: 'POST',
        body: { name: clampName(name), category: category ?? 'custom', layers },
        schema: photoPresetSchema,
        skipAccountInvalidation: true,
      }),
      transformResponse: (r: PhotoPresetRow) => accountPresetOf(r),
      invalidatesTags: ['PhotoPresets'],
    }),
    /** `PUT` with `If-Match: <revision>` (428 without it; 409 `revision_conflict {revision}` when stale). */
    updatePhotoPreset: build.mutation<
      AccountPreset,
      {
        id: string;
        revision: number;
        name?: string;
        category?: UserPresetCategoryId | null;
        layers?: AdjustmentLayer[];
      }
    >({
      query: ({ id, revision, name, category, layers }) => ({
        url: `/photo/presets/${enc(id)}`,
        method: 'PUT',
        headers: { 'If-Match': String(revision) },
        body: {
          ...(name !== undefined ? { name: clampName(name) } : {}),
          ...(category !== undefined ? { category } : {}),
          ...(layers !== undefined ? { layers } : {}),
        },
        schema: photoPresetSchema,
        skipAccountInvalidation: true,
      }),
      transformResponse: (r: PhotoPresetRow) => accountPresetOf(r),
      invalidatesTags: ['PhotoPresets'],
    }),
    deletePhotoPreset: build.mutation<unknown, string>({
      query: (id) => ({
        url: `/photo/presets/${enc(id)}`,
        method: 'DELETE',
        skipAccountInvalidation: true,
      }),
      invalidatesTags: ['PhotoPresets'],
    }),
    /** Multipart PNG from a local file. Best effort for callers: a failed thumbnail never fails a save. */
    uploadPhotoPresetThumbnail: build.mutation<true, { id: string; fileUri: string }>({
      queryFn: async ({ id, fileUri }, api) => {
        const r = await uploadThumbnail(id, fileUri);
        if (r.quota) api.dispatch(observed(r.quota));
        return r.ok ? { data: true } : { error: r.error };
      },
      invalidatesTags: (_r, error) => (error ? [] : ['PhotoPresets']),
    }),
  }),
});

export const {
  useListPhotoPresetsQuery,
  useGetPhotoPresetQuery,
  useCreatePhotoPresetMutation,
  useUpdatePhotoPresetMutation,
  useDeletePhotoPresetMutation,
  useUploadPhotoPresetThumbnailMutation,
} = presetsApi;

/** `…/thumbnail` of a preset (owner-only: the request carries `buildHeaders()`). */
export const presetThumbnailUri = (id: string) =>
  `${API_BASE_URL}/photo/presets/${enc(id)}/thumbnail`;

type UploadResult =
  | { ok: true; quota?: ReturnType<typeof parseQuota> }
  | { ok: false; error: MmError; quota?: ReturnType<typeof parseQuota> };

async function uploadThumbnail(id: string, fileUri: string): Promise<UploadResult> {
  // Lazy require: native modules must not load in pure tests that import this file.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { makeUploadTask } = require('@/jobs/fsTask') as typeof import('@/jobs/fsTask');
  const once = async (forceRefresh: boolean) =>
    makeUploadTask(fileUri, presetThumbnailUri(id), {
      method: 'POST',
      multipart: true,
      headers: await buildHeaders({ forceRefresh }),
      fieldName: 'file',
      mimeType: 'image/png',
      sessionType: 'foreground',
      onProgress: () => undefined,
      signal: new AbortController().signal,
    }).uploadAsync();
  try {
    let r = await once(false);
    if (r.status === 401) r = await once(true);
    const quota = parseQuota(headerBag(r.headers));
    if (r.status >= 200 && r.status < 300) return { ok: true, quota };
    let body: unknown;
    try {
      body = r.body ? JSON.parse(r.body) : undefined;
    } catch {
      body = undefined;
    }
    return { ok: false, error: normaliseError(r.status, body, r.headers), quota };
  } catch (e) {
    return { ok: false, error: networkError(e instanceof Error ? e.message : undefined) };
  }
}

/** The connection, not the server, said no: the sheet shows "You're offline; try again". */
export const isOfflineError = (e: MmError | undefined): boolean =>
  e?.code === 'network' || e?.code === 'timeout';

/** 409 `revision_conflict`: the server's current revision. */
export function presetConflictRevision(e: MmError | undefined): number | null {
  if (!e || e.code !== 'revision_conflict') return null;
  const rev = e.details.revision;
  return typeof rev === 'number' && Number.isInteger(rev) && rev > 0 ? rev : null;
}
