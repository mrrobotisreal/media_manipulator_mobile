/**
 * Darkroom media on the phone (ticket MA61 decisions 6 and 8): getting a picked file into a project
 * and the server's preview media back out. Plain TypeScript over injected deps (`assetsRuntime.ts`
 * wires the app; tests fake S3 and the API):
 *
 * - **pre-flight** before any byte moves: the studio extension list (`isSupportedStudioExtension`
 *   in the API's studio.go), the tier's `maxFileBytes` / `maxVideoSeconds` (MA16 `preflightFile`
 *   over the cached `/account/me`), and the "large uploads on Wi-Fi only" gate (expo-network).
 * - **upload**: `POST /studio/assets/presign` -> PUT straight to S3 through the MA12 native upload
 *   task (background-capable on iOS, progress) -> `POST /studio/assets/complete` (201 / 200
 *   `{asset, jobId}`). A presign older than 14 min when the PUT would start is re-requested (MA12).
 * - **ingest**: poll `GET /studio/projects/:id/assets` until the asset has its proxy (`s3KeyProxy`,
 *   the web's "ready"); the ingest job (`GET /job/:id`) is read only to stop early on a failure.
 *   LUTs complete at once (no ingest job).
 * - **cache**: proxy / reversed proxy / sprite / peaks fetched with the owner headers into
 *   `cache/studio/<assetId>/`, an LRU capped at 256 MB (oldest use evicted first).
 * - **local source** (proposed optimisation): a clip added from this phone keeps its local URI and
 *   probe so MA62 can preview it before the proxy exists, when the probe allows.
 */
import type { MmError } from '@/api/errors';
import { isPresignStale } from '@/jobs/presign';
import type { MakeUploadTask } from '@/jobs/transport';
import { preflightFile, type PreflightLimits } from '@/files/preflight';
import type { PreflightResult } from '@/files/types';
import type { MediaKind } from '@/tools/types';
import { getActiveStudioBackend, type StudioBackend } from './backend';
import type {
  StudioAsset,
  StudioAssetCompleteRequest,
  StudioAssetCompleteResponse,
  StudioAssetPresignRequest,
  StudioAssetPresignResponse,
} from '../studioTypes';

type Result<T> = { ok: true; value: T } | { ok: false; error: MmError };

// ---------------------------------------------------------------------------
// Pre-flight
// ---------------------------------------------------------------------------

/** The API's `isSupportedStudioExtension` (studio.go): video, audio, still images, `.cube` LUTs. */
export const STUDIO_VIDEO_EXTENSIONS = [
  'mp4',
  'mov',
  'm4v',
  'webm',
  'mkv',
  'avi',
  'flv',
  'wmv',
  'mpeg',
  'mpg',
] as const;
export const STUDIO_AUDIO_EXTENSIONS = ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac'] as const;
export const STUDIO_IMAGE_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'bmp',
  'tif',
  'tiff',
  'heic',
  'heif',
  'avif',
  'svg',
] as const;
export const STUDIO_EXTENSIONS: readonly string[] = [
  ...STUDIO_VIDEO_EXTENSIONS,
  ...STUDIO_AUDIO_EXTENSIONS,
  ...STUDIO_IMAGE_EXTENSIONS,
];

/** Above this size the Wi-Fi-only setting applies (proposed, ticket MA61 decision 6). */
export const LARGE_UPLOAD_BYTES = 500 * 1024 * 1024;

export type ConnectionKind = 'wifi' | 'cellular' | 'none' | 'unknown';

export interface StudioFileInput {
  extension: string;
  mimeType: string;
  mediaKind: MediaKind | null;
  sizeBytes: number;
  durationSec?: number;
}

export type StudioPreflight = PreflightResult | { ok: false; reason: 'wifi_required' };

/**
 * Tier caps first (MA16's `preflightFile`; `limits` undefined while `/account/me` loads = skipped,
 * never guessed), then the Wi-Fi gate: a file over 500 MB waits for Wi-Fi when the setting is on and
 * the phone is on cellular. An unknown connection (no expo-network answer yet) never blocks.
 */
export function preflightStudioFile(
  file: StudioFileInput,
  limits: PreflightLimits | undefined,
  net: { wifiOnlyLargeUploads: boolean; connection: ConnectionKind },
): StudioPreflight {
  const r = preflightFile(
    file,
    {
      kinds: ['video', 'audio', 'image'],
      extensions: [...STUDIO_EXTENSIONS],
      mime: [],
    },
    limits,
  );
  if (!r.ok) return r;
  if (
    net.wifiOnlyLargeUploads &&
    file.sizeBytes > LARGE_UPLOAD_BYTES &&
    net.connection === 'cellular'
  ) {
    return { ok: false, reason: 'wifi_required' };
  }
  return r;
}

// ---------------------------------------------------------------------------
// Upload: presign -> PUT (MA12 task) -> complete
// ---------------------------------------------------------------------------

export interface StudioUploadSource {
  projectId: string;
  fileUri: string;
  /** Sent to the API as `fileName` (the bin shows it; it never reaches analytics). */
  fileName: string;
  /** A real media MIME (never octet-stream): S3 checks the PUT against the presigned type. */
  mimeType: string;
  sizeBytes: number;
}

export interface StudioUploadDeps {
  presign(body: StudioAssetPresignRequest): Promise<Result<StudioAssetPresignResponse>>;
  complete(body: StudioAssetCompleteRequest): Promise<Result<StudioAssetCompleteResponse>>;
  makeTask: MakeUploadTask;
  platform: string;
  now(): number;
}

export type StudioUploadOutcome =
  | { ok: true; asset: StudioAsset; jobId: string }
  | {
      ok: false;
      stage: 'presign' | 'put' | 'complete';
      /** rejected: the API said no (4xx); failed: network / S3 / 5xx, retryable; cancelled. */
      kind: 'rejected' | 'failed' | 'cancelled';
      error?: MmError;
      status?: number;
    };

const classify = (e: MmError): 'rejected' | 'failed' =>
  typeof e.status === 'number' && e.status >= 400 && e.status < 500 && e.status !== 408
    ? 'rejected'
    : 'failed';

/**
 * The Content-Type the API presigns for this file (studio.go `PresignAsset`): `.cube` LUTs are
 * signed as octet-stream, everything else with the type the client sent.
 */
export function presignedContentType(fileName: string, mimeType: string): string {
  return /\.cube$/i.test(fileName) ? 'application/octet-stream' : mimeType;
}

export async function uploadStudioAsset(
  src: StudioUploadSource,
  deps: StudioUploadDeps,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<StudioUploadOutcome> {
  if (signal.aborted) return { ok: false, stage: 'presign', kind: 'cancelled' };
  const body: StudioAssetPresignRequest = {
    projectId: src.projectId,
    fileName: src.fileName,
    contentType: src.mimeType,
    fileSizeBytes: src.sizeBytes,
  };
  let signedAt = deps.now();
  let presigned = await deps.presign(body);
  if (!presigned.ok)
    return { ok: false, stage: 'presign', kind: classify(presigned.error), error: presigned.error };
  if (isPresignStale(signedAt, deps.now())) {
    signedAt = deps.now();
    presigned = await deps.presign(body);
    if (!presigned.ok)
      return {
        ok: false,
        stage: 'presign',
        kind: classify(presigned.error),
        error: presigned.error,
      };
  }
  const target = presigned.value;
  const contentType = presignedContentType(src.fileName, src.mimeType);

  // Straight to S3: no API headers; the Content-Type must equal the presigned one.
  let status: number;
  try {
    if (signal.aborted) return { ok: false, stage: 'put', kind: 'cancelled' };
    const task = deps.makeTask(src.fileUri, target.uploadUrl, {
      method: 'PUT',
      multipart: false,
      headers: { 'Content-Type': contentType },
      mimeType: contentType,
      sessionType: deps.platform === 'ios' ? 'background' : 'foreground',
      onProgress: (p) => {
        if (p.totalBytes > 0) onProgress(Math.min(1, p.bytesSent / p.totalBytes));
      },
      signal,
    });
    const onAbort = () => task.cancel();
    signal.addEventListener('abort', onAbort);
    try {
      status = (await task.uploadAsync()).status;
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  } catch {
    if (signal.aborted) return { ok: false, stage: 'put', kind: 'cancelled' };
    return { ok: false, stage: 'put', kind: 'failed' };
  }
  if (status < 200 || status >= 300) return { ok: false, stage: 'put', kind: 'failed', status };
  onProgress(1);

  const done = await deps.complete({
    projectId: src.projectId,
    s3Key: target.s3Key,
    fileName: src.fileName,
    contentType,
    fileSizeBytes: src.sizeBytes,
  });
  if (!done.ok)
    return { ok: false, stage: 'complete', kind: classify(done.error), error: done.error };
  return { ok: true, asset: done.value.asset, jobId: done.value.jobId };
}

// ---------------------------------------------------------------------------
// Ingest status
// ---------------------------------------------------------------------------

export type IngestStatus = 'processing' | 'ready' | 'failed';

/** The web's rule: ready once the asset row has its proxy (LUTs need none). */
export function ingestStatusOf(asset: Pick<StudioAsset, 'mediaKind' | 's3KeyProxy'>): IngestStatus {
  if (asset.mediaKind === 'lut') return 'ready';
  return asset.s3KeyProxy ? 'ready' : 'processing';
}

export interface IngestPollDeps {
  listAssets(projectId: string): Promise<Result<StudioAsset[]>>;
  /** `GET /job/:id` status; only `failed` is acted on (a forgotten job keeps the asset poll going). */
  jobStatus?(jobId: string): Promise<'pending' | 'processing' | 'completed' | 'failed' | null>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export const INGEST_POLL_MS = 2000;
/** The API's ingest runs under its command timeout; stop watching well after it. */
export const INGEST_GIVE_UP_MS = 45 * 60 * 1000;

export async function waitForIngest(
  projectId: string,
  assetId: string,
  jobId: string | null,
  deps: IngestPollDeps,
  opts: { signal?: AbortSignal; onAsset?: (a: StudioAsset) => void } = {},
): Promise<{ status: IngestStatus | 'timeout' | 'cancelled'; asset?: StudioAsset }> {
  const start = deps.now();
  let last: StudioAsset | undefined;
  for (;;) {
    if (opts.signal?.aborted) return { status: 'cancelled', asset: last };
    const res = await deps.listAssets(projectId);
    if (res.ok) {
      const a = res.value.find((x) => x.id === assetId);
      if (!a) return { status: 'failed' }; // deleted (or never recorded)
      last = a;
      opts.onAsset?.(a);
      if (ingestStatusOf(a) === 'ready') return { status: 'ready', asset: a };
    }
    if (jobId && deps.jobStatus) {
      const js = await deps.jobStatus(jobId);
      if (js === 'failed') return { status: 'failed', asset: last };
    }
    if (deps.now() - start > INGEST_GIVE_UP_MS) return { status: 'timeout', asset: last };
    await deps.sleep(INGEST_POLL_MS);
  }
}

// ---------------------------------------------------------------------------
// Preview media cache (LRU, 256 MB)
// ---------------------------------------------------------------------------

export type StudioMediaKind = 'proxy' | 'proxyReversed' | 'sprite' | 'peaks';

export const STUDIO_CACHE_CAP_BYTES = 256 * 1024 * 1024;

export interface CacheEntryInfo {
  /** `<assetId>/<file>` relative to `cache/studio/`. */
  path: string;
  size: number;
  /** Last modification (download) time, epoch ms: the LRU seed after a restart. */
  mtime: number;
}

export interface StudioCacheFs {
  list(): CacheEntryInfo[];
  /** Absolute file URI for a cache path. */
  uri(path: string): string;
  exists(path: string): boolean;
  remove(path: string): void;
  /** Downloads `url` with `headers` to `path`; resolves with the stored size. */
  download(url: string, path: string, headers: Record<string, string>): Promise<number>;
}

/** The file name a medium is cached under (the proxy generation is part of it, MM71). */
export function cachePath(
  asset: Pick<StudioAsset, 'id' | 'mediaKind' | 'proxyGeneration'>,
  kind: StudioMediaKind,
): string {
  const id = asset.id.replace(/[^A-Za-z0-9_-]/g, '_');
  const g = asset.proxyGeneration && asset.proxyGeneration >= 1 ? `-g${asset.proxyGeneration}` : '';
  switch (kind) {
    case 'proxy':
      return `${id}/proxy${g}.${asset.mediaKind === 'audio' ? 'm4a' : asset.mediaKind === 'image' ? 'img' : 'mp4'}`;
    case 'proxyReversed':
      return `${id}/proxy-reversed${g}.mp4`;
    case 'sprite':
      return `${id}/sprite.jpg`;
    case 'peaks':
      return `${id}/peaks.json`;
  }
}

function mediaUrl(
  backend: StudioBackend,
  asset: Pick<StudioAsset, 'id'>,
  kind: StudioMediaKind,
): string {
  switch (kind) {
    case 'proxy':
      return backend.proxyUrl(asset.id);
    case 'proxyReversed':
      return backend.proxyReversedUrl?.(asset.id) ?? '';
    case 'sprite':
      return backend.spriteUrl(asset.id);
    case 'peaks':
      return backend.peaksUrl?.(asset.id) ?? '';
  }
}

export function createStudioMediaCache(deps: {
  fs: StudioCacheFs;
  headers: () => Promise<Record<string, string>>;
  now: () => number;
  capBytes?: number;
  backend?: () => StudioBackend;
}) {
  const cap = deps.capBytes ?? STUDIO_CACHE_CAP_BYTES;
  const backend = deps.backend ?? getActiveStudioBackend;
  const lastUsed = new Map<string, number>();
  const inflight = new Map<string, Promise<string | null>>();
  let seeded = false;
  const seed = () => {
    if (seeded) return;
    seeded = true;
    for (const e of deps.fs.list()) if (!lastUsed.has(e.path)) lastUsed.set(e.path, e.mtime);
  };

  /** Evicts least-recently-used files until the cache fits, never one of `keep`. */
  function evict(keep: ReadonlySet<string> = new Set()): string[] {
    seed();
    const entries = deps.fs.list();
    let total = entries.reduce((n, e) => n + e.size, 0);
    if (total <= cap) return [];
    const order = [...entries].sort(
      (a, b) => (lastUsed.get(a.path) ?? a.mtime) - (lastUsed.get(b.path) ?? b.mtime),
    );
    const removed: string[] = [];
    for (const e of order) {
      if (total <= cap) break;
      if (keep.has(e.path)) continue;
      try {
        deps.fs.remove(e.path);
        total -= e.size;
        lastUsed.delete(e.path);
        removed.push(e.path);
      } catch {
        // best effort: try the next one
      }
    }
    return removed;
  }

  /**
   * The local file URI of an asset's medium, fetched with the owner headers on a miss; null when
   * the backend has no such route or the fetch failed (the caller shows its placeholder).
   */
  async function get(
    asset: Pick<StudioAsset, 'id' | 'mediaKind' | 'proxyGeneration'>,
    kind: StudioMediaKind,
  ): Promise<string | null> {
    seed();
    const path = cachePath(asset, kind);
    if (deps.fs.exists(path)) {
      lastUsed.set(path, deps.now());
      return deps.fs.uri(path);
    }
    const pending = inflight.get(path);
    if (pending) return pending;
    const url = mediaUrl(backend(), asset, kind);
    if (!url) return null;
    const run = (async () => {
      try {
        await deps.fs.download(url, path, await deps.headers());
        lastUsed.set(path, deps.now());
        evict(new Set([path]));
        return deps.fs.uri(path);
      } catch {
        return null;
      } finally {
        inflight.delete(path);
      }
    })();
    inflight.set(path, run);
    return run;
  }

  /** Drops every cached medium of an asset (deleted from the bin, proxy rebuilt). */
  function forget(assetId: string) {
    const prefix = `${assetId.replace(/[^A-Za-z0-9_-]/g, '_')}/`;
    for (const e of deps.fs.list()) {
      if (!e.path.startsWith(prefix)) continue;
      try {
        deps.fs.remove(e.path);
      } catch {
        // best effort
      }
      lastUsed.delete(e.path);
    }
  }

  return {
    get,
    evict,
    forget,
    totalBytes: () => deps.fs.list().reduce((n, e) => n + e.size, 0),
  };
}

// ---------------------------------------------------------------------------
// Local-source preview (proposed, ticket MA61 decision 8)
// ---------------------------------------------------------------------------

/** What the app knows about a clip's source that came from this phone. */
export interface LocalSourceProbe {
  /** The intake copy (`cache/intake/<id>/…`), swept after 24 h unreferenced. */
  uri: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  durationSec?: number;
  /** e.g. 'h264' / 'hevc' when known (the server probe's `videoCodec` once complete answers). */
  codec?: string;
  /** Unknown (undefined) on the phone today: no native module reads it (see `canPreviewLocally`). */
  bitDepth?: number;
  hdr?: boolean;
}

const LOCAL_MAX_EDGE = 1920;
const LOCAL_MAX_SHORT_EDGE = 1080;

/**
 * DARKROOM_MOBILE.md §4: an 8-bit SDR H.264 / HEVC clip of at most 1080p may preview from the
 * local file until its proxy is ready. HEVC needs a positive 8-bit, non-HDR probe (phone HEVC is
 * usually 10-bit HDR); H.264 from phones is 8-bit SDR unless a probe says otherwise. Images always
 * may (Skia decodes them). Anything unknown waits for the proxy.
 */
export function canPreviewLocally(p: LocalSourceProbe, kind: StudioAsset['mediaKind']): boolean {
  if (kind === 'image') return true;
  if (kind !== 'video') return false;
  const w = p.width ?? 0;
  const h = p.height ?? 0;
  if (w <= 0 || h <= 0) return false;
  if (Math.max(w, h) > LOCAL_MAX_EDGE || Math.min(w, h) > LOCAL_MAX_SHORT_EDGE) return false;
  if (p.hdr === true || (p.bitDepth !== undefined && p.bitDepth > 8)) return false;
  const codec = (p.codec ?? '').toLowerCase();
  if (codec === 'h264' || codec === 'avc' || codec === 'avc1') return true;
  if (codec === 'hevc' || codec === 'h265' || codec === 'hvc1' || codec === 'hev1')
    return p.bitDepth === 8 && p.hdr === false;
  return false;
}

/** In-memory registry of this session's phone-sourced assets (asset id -> probe). */
export function createLocalSources() {
  const map = new Map<string, LocalSourceProbe>();
  return {
    record(assetId: string, probe: LocalSourceProbe) {
      map.set(assetId, probe);
    },
    /** Adopts the server probe (codec) once `complete` answered. */
    adoptServerProbe(asset: Pick<StudioAsset, 'id' | 'videoCodec' | 'width' | 'height'>) {
      const p = map.get(asset.id);
      if (!p) return;
      map.set(asset.id, {
        ...p,
        codec: p.codec ?? asset.videoCodec,
        width: p.width ?? asset.width,
        height: p.height ?? asset.height,
      });
    },
    get: (assetId: string) => map.get(assetId),
    /** The local URI MA62 previews from, or null (wait for the proxy). */
    previewUri(asset: Pick<StudioAsset, 'id' | 'mediaKind' | 's3KeyProxy'>): string | null {
      if (asset.s3KeyProxy) return null; // the proxy is the decoder-safe choice once it exists
      const p = map.get(asset.id);
      return p && canPreviewLocally(p, asset.mediaKind) ? p.uri : null;
    },
    forget(assetId: string) {
      map.delete(assetId);
    },
  };
}
