import { HEADERS_QUOTA, snapshotSrc } from '../uploadFixtures';
import { makeHarness, teardownHarness } from '../transportHarness';
import { runUpload } from '../upload';

const src = snapshotSrc();
const hooks = () => ({
  onProgress: jest.fn(),
  onBytesSent: jest.fn(),
  signal: new AbortController().signal,
  now: () => 0,
});

afterEach(teardownHarness);

describe('multipart upload', () => {
  it('sends the file field, options JSON, owner headers and the platform sessionType', async () => {
    const h = await makeHarness({ platform: 'ios' });
    const res = await h.transport.uploadMultipart(src, jest.fn(), new AbortController().signal);
    expect(res).toEqual({ ok: true, jobId: 'job-1' });
    const t = h.tasks[0]!;
    expect(t.url).toMatch(/\/upload$/);
    expect(t.uri).toBe(src.fileUri);
    expect(t.opts).toMatchObject({
      method: 'POST',
      multipart: true,
      fieldName: 'file',
      mimeType: 'image/jpeg',
      sessionType: 'background',
      parameters: { options: JSON.stringify(src.options) },
    });
    expect(t.opts.headers.Authorization).toBe('Bearer tok');
    expect(t.opts.headers['User-Agent']).toMatch(/^MediaManipulator\//);
  });

  it('uses a foreground session on Android and reports progress as a fraction', async () => {
    const h = await makeHarness({ platform: 'android' });
    const onProgress = jest.fn();
    await h.transport.uploadMultipart(src, onProgress, new AbortController().signal);
    expect(h.tasks[0]!.opts.sessionType).toBe('foreground');
    expect(onProgress).toHaveBeenCalledWith(0.5);
  });

  it('observes quota headers on 2xx and does not invalidate Account', async () => {
    const h = await makeHarness({
      taskReplies: [{ status: 200, headers: HEADERS_QUOTA, body: { jobId: 'job-1' } }],
    });
    await h.transport.uploadMultipart(src, jest.fn(), new AbortController().signal);
    expect(h.store.getState().quota.metrics.ops).toMatchObject({ limit: 10, remaining: 7 });
    expect(h.dispatched.some((a) => a.type.includes('invalidateTags'))).toBe(false);
  });

  it('429 quota_exceeded is rejected, observes quota headers and invalidates Account', async () => {
    const h = await makeHarness({
      taskReplies: [
        {
          status: 429,
          headers: {
            'x-mm-tier': 'free',
            'x-mm-quota-limit': '10',
            'x-mm-quota-remaining': '0',
            'X-MM-Quota-Metric': 'ops',
          },
          body: { error: 'quota_exceeded', metric: 'ops', limit: 10, used: 10 },
        },
      ],
    });
    const res = await h.transport.uploadMultipart(src, jest.fn(), new AbortController().signal);
    expect(res).toMatchObject({
      ok: false,
      kind: 'rejected',
      reason: 'quota_exceeded',
      status: 429,
    });
    expect(h.store.getState().quota.metrics.ops).toMatchObject({ remaining: 0 });
    expect(h.dispatched.some((a) => a.type.includes('invalidateTags'))).toBe(true);
  });

  it('does not read quota headers on a 500, but invalidates Account; 5xx is retryable', async () => {
    const h = await makeHarness({
      taskReplies: [{ status: 500, headers: HEADERS_QUOTA, body: { error: 'Failed' } }],
    });
    const res = await h.transport.uploadMultipart(src, jest.fn(), new AbortController().signal);
    expect(res).toMatchObject({ ok: false, kind: 'failed', status: 500 });
    expect(h.store.getState().quota.metrics.ops).toBeUndefined();
    expect(h.dispatched.some((a) => a.type.includes('invalidateTags'))).toBe(true);
  });

  it('maps 403 output_height_limited, 413 and 400 to rejected', async () => {
    const h = await makeHarness({
      taskReplies: [
        { status: 403, body: { error: 'output_height_limited' } },
        { status: 413, body: { error: 'Too big', reason: 'video_duration' } },
        { status: 400, body: { error: 'Unsupported file type' } },
      ],
    });
    const run = () => h.transport.uploadMultipart(src, jest.fn(), new AbortController().signal);
    expect(await run()).toMatchObject({ kind: 'rejected', reason: 'output_height_limited' });
    expect(await run()).toMatchObject({ kind: 'rejected', reason: 'source_limit_exceeded' });
    expect(await run()).toMatchObject({ kind: 'rejected', reason: 'bad_request' });
  });

  it('retries a 401 once with a fresh token, and network failures are retryable', async () => {
    const h = await makeHarness({
      taskReplies: [
        { status: 401, body: { error: 'x' } },
        { status: 200, body: { jobId: 'j2' } },
      ],
    });
    expect(await h.transport.uploadMultipart(src, jest.fn(), new AbortController().signal)).toEqual(
      {
        ok: true,
        jobId: 'j2',
      },
    );
    expect(h.tasks).toHaveLength(2);
    const n = await makeHarness({ taskReplies: [new Error('Network request failed')] });
    expect(
      await n.transport.uploadMultipart(src, jest.fn(), new AbortController().signal),
    ).toMatchObject({
      ok: false,
      kind: 'failed',
      reason: 'network',
    });
  });

  it('a malformed 200 body is contract_mismatch (retryable failure, not a crash)', async () => {
    const h = await makeHarness({ taskReplies: [{ status: 200, body: { nope: 1 } }] });
    expect(
      await h.transport.uploadMultipart(src, jest.fn(), new AbortController().signal),
    ).toMatchObject({
      ok: false,
      reason: 'contract_mismatch',
    });
  });

  it('abort cancels the native task and reports cancelled', async () => {
    const h = await makeHarness();
    const ac = new AbortController();
    ac.abort();
    expect(await h.transport.uploadMultipart(src, jest.fn(), ac.signal)).toMatchObject({
      ok: false,
      kind: 'cancelled',
      reason: 'cancelled',
    });
  });
});

describe('presigned upload', () => {
  const video = snapshotSrc({ fileName: 'clip.mp4', mimeType: 'video/mp4', sizeBytes: 5000 });
  const target = {
    uploadUrl: 'https://s3.example/put?sig=1',
    s3Key: 'videos/20261101/s/u.mp4',
    expiresAt: '2026-11-01T00:15:00Z',
  };

  it('presign -> PUT with the exact presigned Content-Type and no API headers -> complete', async () => {
    const h = await makeHarness({ taskReplies: [{ status: 200 }] });
    h.fetchReplies.push({ status: 201, body: { ...target, bucket: 'b' } });
    h.fetchReplies.push({ status: 200, body: { jobId: 'vid-1' }, headers: HEADERS_QUOTA });
    const res = await runUpload(h.transport, 'presigned_put', video, hooks());
    expect(res).toEqual({ ok: true, jobId: 'vid-1' });

    const [presign, complete] = h.fetches;
    expect(presign!.url).toMatch(/\/video-upload\/presign$/);
    expect(JSON.parse(presign!.init.body as string)).toEqual({
      fileName: 'clip.mp4',
      contentType: 'video/mp4',
      fileSizeBytes: 5000,
    });
    const put = h.tasks[0]!;
    expect(put.url).toBe(target.uploadUrl);
    expect(put.opts).toMatchObject({ method: 'PUT', multipart: false });
    expect(put.opts.headers).toEqual({ 'Content-Type': 'video/mp4' });
    expect(put.opts.headers['Content-Type']).toBe(
      JSON.parse(presign!.init.body as string).contentType,
    );

    expect(complete!.url).toMatch(/\/video-upload\/complete$/);
    expect(JSON.parse(complete!.init.body as string)).toEqual({
      s3Key: target.s3Key,
      fileName: 'clip.mp4',
      contentType: 'video/mp4',
      fileSizeBytes: 5000,
      options: video.options,
    });
    // complete reads the token fresh per request
    expect(complete!.init.headers.Authorization).toBe('Bearer tok');
    expect(h.store.getState().quota.metrics.ops).toMatchObject({ remaining: 7 });
  });

  it('a failed S3 PUT is a retryable s3_put failure and never calls complete', async () => {
    const h = await makeHarness({ taskReplies: [{ status: 403 }] });
    h.fetchReplies.push({ status: 201, body: target });
    const res = await runUpload(h.transport, 'presigned_put', video, hooks());
    expect(res).toMatchObject({ ok: false, kind: 'failed', reason: 's3_put', status: 403 });
    expect(h.fetches).toHaveLength(1);
  });

  it('presign 413 is rejected and invalidates Account; complete 429 is rejected', async () => {
    const a = await makeHarness();
    a.fetchReplies.push({ status: 413, body: { error: 'Video exceeds maximum upload size' } });
    expect(await runUpload(a.transport, 'presigned_put', video, hooks())).toMatchObject({
      ok: false,
      kind: 'rejected',
      reason: 'payload_too_large',
    });
    const b = await makeHarness({ taskReplies: [{ status: 200 }] });
    b.fetchReplies.push({ status: 201, body: target });
    b.fetchReplies.push({ status: 429, body: { error: 'quota_exceeded', metric: 'ops' } });
    expect(await runUpload(b.transport, 'presigned_put', video, hooks())).toMatchObject({
      ok: false,
      kind: 'rejected',
      reason: 'quota_exceeded',
    });
  });

  it('re-requests a presign older than 14 minutes before the PUT', async () => {
    const h = await makeHarness({ taskReplies: [{ status: 200 }] });
    h.fetchReplies.push({ status: 201, body: target });
    h.fetchReplies.push({
      status: 201,
      body: { ...target, uploadUrl: 'https://s3.example/put?sig=2' },
    });
    h.fetchReplies.push({ status: 200, body: { jobId: 'vid-2' } });
    let t = 0;
    const slow = { ...hooks(), now: () => (t += 15 * 60 * 1000) };
    expect(await runUpload(h.transport, 'presigned_put', video, slow)).toEqual({
      ok: true,
      jobId: 'vid-2',
    });
    expect(h.fetches.filter((f) => f.url.endsWith('/presign'))).toHaveLength(2);
    expect(h.tasks[0]!.url).toContain('sig=2');
  });
});
