import { normaliseError } from '@/api/errors';
import type { MakeTaskOptions, UploadTaskLike } from '@/jobs/transport';
import type { StudioAsset } from '../../studioTypes';
import { createAppStudioBackend } from '../backend';
import {
  LARGE_UPLOAD_BYTES,
  STUDIO_CACHE_CAP_BYTES,
  cachePath,
  canPreviewLocally,
  createLocalSources,
  createStudioMediaCache,
  ingestStatusOf,
  preflightStudioFile,
  uploadStudioAsset,
  waitForIngest,
  type CacheEntryInfo,
  type StudioCacheFs,
  type StudioUploadDeps,
} from '../assets';

const asset = (over: Partial<StudioAsset> = {}): StudioAsset => ({
  id: 'a1',
  projectId: 'p1',
  originalFileName: 'clip.mp4',
  s3KeyOriginal: 'studio/20261119/s/a1.mp4',
  mediaKind: 'video',
  durationSeconds: 12,
  hasAudio: true,
  probeJson: {},
  createdAt: '2026-11-19T00:00:00Z',
  ...over,
});

/** A fake S3: records every PUT; answers with `status`. */
function fakeS3(status = 200) {
  const puts: { uri: string; url: string; opts: MakeTaskOptions }[] = [];
  const makeTask = (uri: string, url: string, opts: MakeTaskOptions): UploadTaskLike => ({
    async uploadAsync() {
      puts.push({ uri, url, opts });
      opts.onProgress({ bytesSent: 50, totalBytes: 100 });
      opts.onProgress({ bytesSent: 100, totalBytes: 100 });
      return { status, headers: {}, body: '' };
    },
    cancel: jest.fn(),
  });
  return { puts, makeTask };
}

function uploadDeps(over: Partial<StudioUploadDeps> = {}) {
  const s3 = fakeS3();
  let clock = 0;
  const deps: StudioUploadDeps = {
    presign: jest.fn(async (b) => ({
      ok: true as const,
      value: {
        uploadUrl: `https://s3.test/put/${b.fileName}?sig=1`,
        s3Key: `studio/k/${b.fileName}`,
        bucket: 'b',
        expiresAt: '2026-11-19T00:15:00Z',
      },
    })),
    complete: jest.fn(async () => ({
      ok: true as const,
      value: { asset: asset(), jobId: 'job-1' },
    })),
    makeTask: s3.makeTask,
    platform: 'android',
    now: () => clock,
    ...over,
  };
  return { deps, s3, tick: (ms: number) => (clock += ms) };
}

const SRC = {
  projectId: 'p1',
  fileUri: 'file:///cache/intake/1/clip.mp4',
  fileName: 'clip.mp4',
  mimeType: 'video/mp4',
  sizeBytes: 100,
};

describe('studio asset upload (presign -> PUT -> complete)', () => {
  it('presigns, PUTs the bytes straight to S3 with the presigned type, completes', async () => {
    const { deps, s3 } = uploadDeps();
    const progress: number[] = [];
    const r = await uploadStudioAsset(
      SRC,
      deps,
      (f) => progress.push(f),
      new AbortController().signal,
    );
    expect(r).toEqual({ ok: true, asset: asset(), jobId: 'job-1' });
    expect(deps.presign).toHaveBeenCalledWith({
      projectId: 'p1',
      fileName: 'clip.mp4',
      contentType: 'video/mp4',
      fileSizeBytes: 100,
    });
    expect(s3.puts).toHaveLength(1);
    const put = s3.puts[0]!;
    expect(put.url).toBe('https://s3.test/put/clip.mp4?sig=1');
    expect(put.opts).toMatchObject({ method: 'PUT', multipart: false, mimeType: 'video/mp4' });
    // No API credentials on the S3 request.
    expect(put.opts.headers).toEqual({ 'Content-Type': 'video/mp4' });
    expect(progress).toEqual([0.5, 1, 1]);
    expect(deps.complete).toHaveBeenCalledWith({
      projectId: 'p1',
      s3Key: 'studio/k/clip.mp4',
      fileName: 'clip.mp4',
      contentType: 'video/mp4',
      fileSizeBytes: 100,
    });
  });

  it('a LUT is PUT as octet-stream (what the API signs for .cube)', async () => {
    const { deps, s3 } = uploadDeps();
    await uploadStudioAsset(
      { ...SRC, fileName: 'look.cube', mimeType: 'text/plain' },
      deps,
      () => undefined,
      new AbortController().signal,
    );
    expect(s3.puts[0]!.opts.headers['Content-Type']).toBe('application/octet-stream');
  });

  it('re-presigns when the URL is older than 14 min at PUT time', async () => {
    const h = uploadDeps();
    (h.deps.presign as jest.Mock).mockImplementationOnce(async (b) => {
      h.tick(15 * 60 * 1000);
      return {
        ok: true,
        value: {
          uploadUrl: 'https://s3.test/old',
          s3Key: `k/${b.fileName}`,
          bucket: 'b',
          expiresAt: 'x',
        },
      };
    });
    await uploadStudioAsset(SRC, h.deps, () => undefined, new AbortController().signal);
    expect(h.deps.presign).toHaveBeenCalledTimes(2);
    expect(h.s3.puts[0]!.url).not.toBe('https://s3.test/old');
  });

  it('a 413 at presign is a rejection; an S3 5xx is a retryable PUT failure', async () => {
    const a = uploadDeps({
      presign: async () => ({
        ok: false,
        error: normaliseError(413, { error: 'File exceeds maximum upload size' }),
      }),
    });
    const r1 = await uploadStudioAsset(SRC, a.deps, () => undefined, new AbortController().signal);
    expect(r1).toMatchObject({ ok: false, stage: 'presign', kind: 'rejected' });

    const s3 = fakeS3(503);
    const b = uploadDeps({ makeTask: s3.makeTask });
    const r2 = await uploadStudioAsset(SRC, b.deps, () => undefined, new AbortController().signal);
    expect(r2).toEqual({ ok: false, stage: 'put', kind: 'failed', status: 503 });
    expect(b.deps.complete).not.toHaveBeenCalled();
  });

  it('cancel before the PUT sends nothing', async () => {
    const { deps, s3 } = uploadDeps();
    const c = new AbortController();
    c.abort();
    const r = await uploadStudioAsset(SRC, deps, () => undefined, c.signal);
    expect(r).toMatchObject({ ok: false, kind: 'cancelled' });
    expect(s3.puts).toHaveLength(0);
  });
});

describe('studio ingest poll', () => {
  it('polls the asset list until the proxy key appears', async () => {
    let calls = 0;
    const seen: IngestSnapshot[] = [];
    type IngestSnapshot = ReturnType<typeof ingestStatusOf>;
    const r = await waitForIngest(
      'p1',
      'a1',
      'job-1',
      {
        listAssets: async () => {
          calls += 1;
          return {
            ok: true,
            value: [
              asset(calls >= 3 ? { s3KeyProxy: 'k/a1_proxy_g1.mp4', thumbnailSpriteUrl: 's' } : {}),
            ],
          };
        },
        jobStatus: async () => 'processing',
        sleep: async () => undefined,
        now: () => 0,
      },
      { onAsset: (a) => seen.push(ingestStatusOf(a)) },
    );
    expect(r.status).toBe('ready');
    expect(r.asset?.s3KeyProxy).toBe('k/a1_proxy_g1.mp4');
    expect(seen).toEqual(['processing', 'processing', 'ready']);
  });

  it('stops on a failed ingest job; a vanished asset is failed; it gives up eventually', async () => {
    const base = {
      listAssets: async () => ({ ok: true as const, value: [asset()] }),
      sleep: async () => undefined,
    };
    expect(
      (
        await waitForIngest('p1', 'a1', 'j', {
          ...base,
          jobStatus: async () => 'failed',
          now: () => 0,
        })
      ).status,
    ).toBe('failed');
    expect(
      (
        await waitForIngest('p1', 'a1', null, {
          ...base,
          listAssets: async () => ({ ok: true, value: [] }),
          now: () => 0,
        })
      ).status,
    ).toBe('failed');
    let t = 0;
    expect(
      (await waitForIngest('p1', 'a1', null, { ...base, now: () => (t += 10 * 60 * 1000) })).status,
    ).toBe('timeout');
  });

  it('LUTs are ready at once; images and audio need their proxy like the web', () => {
    expect(ingestStatusOf(asset({ mediaKind: 'lut' }))).toBe('ready');
    expect(ingestStatusOf(asset({ mediaKind: 'image' }))).toBe('processing');
    expect(ingestStatusOf(asset({ mediaKind: 'image', s3KeyProxy: 'k/x_proxy.jpg' }))).toBe(
      'ready',
    );
    expect(ingestStatusOf(asset({ mediaKind: 'audio', s3KeyProxy: 'k/x_proxy.m4a' }))).toBe(
      'ready',
    );
  });
});

describe('studio upload pre-flight', () => {
  const limits = { maxFileBytes: 1024 * 1024 * 1024, maxVideoSeconds: 3600 };
  const wifi = { wifiOnlyLargeUploads: true, connection: 'wifi' as const };
  const file = (over = {}) => ({
    extension: 'mp4',
    mimeType: 'video/mp4',
    mediaKind: 'video' as const,
    sizeBytes: 10,
    durationSec: 30,
    ...over,
  });

  it('checks the tier MaxFileBytes and maxVideoSeconds before presign', () => {
    expect(preflightStudioFile(file({ sizeBytes: limits.maxFileBytes + 1 }), limits, wifi)).toEqual(
      {
        ok: false,
        reason: 'too_large',
        limit: limits.maxFileBytes,
      },
    );
    expect(preflightStudioFile(file({ durationSec: 4000 }), limits, wifi)).toMatchObject({
      reason: 'too_long',
    });
    // Limits still loading: never guessed.
    expect(preflightStudioFile(file({ sizeBytes: 9e12 }), undefined, wifi)).toEqual({ ok: true });
  });

  it('accepts the studio extensions (stills included), refuses the rest', () => {
    expect(
      preflightStudioFile(
        file({ extension: 'heic', mimeType: 'image/heic', mediaKind: 'image' }),
        limits,
        wifi,
      ).ok,
    ).toBe(true);
    expect(
      preflightStudioFile(
        file({ extension: 'm4a', mimeType: 'audio/mp4', mediaKind: 'audio' }),
        limits,
        wifi,
      ).ok,
    ).toBe(true);
    expect(
      preflightStudioFile(
        file({ extension: 'pdf', mimeType: 'application/pdf', mediaKind: 'pdf' }),
        limits,
        wifi,
      ),
    ).toMatchObject({ reason: 'unsupported_type' });
    expect(
      preflightStudioFile(file({ extension: '3gp', mimeType: 'video/3gpp' }), limits, wifi),
    ).toMatchObject({ reason: 'unsupported_type' });
  });

  it('large uploads wait for Wi-Fi on cellular when the setting is on', () => {
    const big = file({ sizeBytes: LARGE_UPLOAD_BYTES + 1 });
    const big5 = { maxFileBytes: 5 * 1024 ** 3, maxVideoSeconds: 0 };
    expect(
      preflightStudioFile(big, big5, { wifiOnlyLargeUploads: true, connection: 'cellular' }),
    ).toEqual({ ok: false, reason: 'wifi_required' });
    expect(
      preflightStudioFile(big, big5, { wifiOnlyLargeUploads: false, connection: 'cellular' }).ok,
    ).toBe(true);
    expect(
      preflightStudioFile(big, big5, { wifiOnlyLargeUploads: true, connection: 'unknown' }).ok,
    ).toBe(true);
    expect(
      preflightStudioFile(file({ sizeBytes: LARGE_UPLOAD_BYTES }), big5, {
        wifiOnlyLargeUploads: true,
        connection: 'cellular',
      }).ok,
    ).toBe(true);
  });
});

/** An in-memory cache dir: path -> {size, mtime}. */
function memFs() {
  const files = new Map<string, { size: number; mtime: number }>();
  const downloads: { url: string; headers: Record<string, string> }[] = [];
  const fs: StudioCacheFs = {
    list: () => [...files].map(([path, f]): CacheEntryInfo => ({ path, ...f })),
    uri: (p) => `file:///cache/studio/${p}`,
    exists: (p) => files.has(p),
    remove: (p) => void files.delete(p),
    download: async (url, path, headers) => {
      downloads.push({ url, headers });
      const size = path.includes('proxy') ? 100 : 10;
      files.set(path, { size, mtime: 0 });
      return size;
    },
  };
  return { fs, files, downloads };
}

describe('studio media cache (LRU)', () => {
  const backend = () => createAppStudioBackend('https://api.test/api');

  it('fetches proxy / sprite / peaks with the owner headers into cache/studio/<assetId>/', async () => {
    const m = memFs();
    const cache = createStudioMediaCache({
      fs: m.fs,
      headers: async () => ({ Authorization: 'Bearer t', 'X-MM-Session-ID': 's' }),
      now: () => 1,
      backend,
    });
    const uri = await cache.get(asset({ proxyGeneration: 1 }), 'proxy');
    expect(uri).toBe('file:///cache/studio/a1/proxy-g1.mp4');
    expect(m.downloads[0]).toEqual({
      url: 'https://api.test/api/studio/assets/a1/proxy',
      headers: { Authorization: 'Bearer t', 'X-MM-Session-ID': 's' },
    });
    await cache.get(asset(), 'sprite');
    await cache.get(asset(), 'peaks');
    expect(m.downloads.map((d) => d.url.split('/').pop())).toEqual(['proxy', 'sprite', 'peaks']);
    // A hit does not download again; concurrent misses share one download.
    await Promise.all([
      cache.get(asset(), 'sprite'),
      cache.get(asset({ id: 'a2' }), 'sprite'),
      cache.get(asset({ id: 'a2' }), 'sprite'),
    ]);
    expect(m.downloads).toHaveLength(4);
  });

  it('evicts the least recently USED files first once over the cap, never the new one', async () => {
    const m = memFs();
    let now = 0;
    const cache = createStudioMediaCache({
      fs: m.fs,
      headers: async () => ({}),
      now: () => (now += 1),
      capBytes: 250,
      backend,
    });
    await cache.get(asset({ id: 'old' }), 'proxy'); // 100
    await cache.get(asset({ id: 'mid' }), 'proxy'); // 200
    await cache.get(asset({ id: 'old' }), 'proxy'); // hit: "old" is now the most recent
    await cache.get(asset({ id: 'new' }), 'proxy'); // 300 > 250 -> evict "mid"
    expect([...m.files.keys()].sort()).toEqual(['new/proxy.mp4', 'old/proxy.mp4']);
    expect(cache.totalBytes()).toBe(200);
  });

  it('seeds the LRU from file times after a restart; forget drops one asset', async () => {
    const m = memFs();
    m.files.set('x/proxy.mp4', { size: 100, mtime: 5 });
    m.files.set('y/proxy.mp4', { size: 100, mtime: 1 });
    const cache = createStudioMediaCache({
      fs: m.fs,
      headers: async () => ({}),
      now: () => 10,
      capBytes: 250,
      backend,
    });
    await cache.get(asset({ id: 'z' }), 'proxy');
    expect(m.files.has('y/proxy.mp4')).toBe(false);
    cache.forget('x');
    expect([...m.files.keys()]).toEqual(['z/proxy.mp4']);
  });

  it('is capped at 256 MB by default; a failed download returns null', async () => {
    expect(STUDIO_CACHE_CAP_BYTES).toBe(256 * 1024 * 1024);
    const m = memFs();
    m.fs.download = async () => {
      throw new Error('404');
    };
    const cache = createStudioMediaCache({
      fs: m.fs,
      headers: async () => ({}),
      now: () => 1,
      backend,
    });
    expect(await cache.get(asset(), 'proxy')).toBeNull();
    expect(cachePath(asset({ mediaKind: 'audio' }), 'proxy')).toBe('a1/proxy.m4a');
  });
});

describe('local-source preview data (proposed)', () => {
  const probe = {
    uri: 'file:///x.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 1,
    width: 1920,
    height: 1080,
  };

  it('8-bit SDR H.264 up to 1080p previews locally; HEVC needs a positive 8-bit SDR probe', () => {
    expect(canPreviewLocally({ ...probe, codec: 'h264' }, 'video')).toBe(true);
    expect(canPreviewLocally({ ...probe, codec: 'h264', width: 3840, height: 2160 }, 'video')).toBe(
      false,
    );
    expect(canPreviewLocally({ ...probe, codec: 'h264', hdr: true }, 'video')).toBe(false);
    expect(canPreviewLocally({ ...probe, codec: 'hevc' }, 'video')).toBe(false);
    expect(canPreviewLocally({ ...probe, codec: 'hevc', bitDepth: 8, hdr: false }, 'video')).toBe(
      true,
    );
    expect(canPreviewLocally({ ...probe }, 'video')).toBe(false); // codec unknown
    expect(canPreviewLocally({ ...probe, width: undefined }, 'image')).toBe(true);
  });

  it('records the local URI, adopts the server codec, and hands over once the proxy exists', () => {
    const l = createLocalSources();
    l.record('a1', probe);
    expect(l.previewUri(asset())).toBeNull(); // codec unknown yet
    l.adoptServerProbe(asset({ videoCodec: 'h264' }));
    expect(l.previewUri(asset())).toBe('file:///x.mp4');
    expect(l.previewUri(asset({ s3KeyProxy: 'k' }))).toBeNull();
  });
});
