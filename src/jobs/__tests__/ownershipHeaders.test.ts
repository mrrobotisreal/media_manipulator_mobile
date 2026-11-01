import { makeHarness, teardownHarness, textStream } from '../transportHarness';

afterEach(teardownHarness);

const OWNER = [
  'Authorization',
  'X-MM-Session-ID',
  'X-MM-Visitor-ID',
  'X-MM-Request-ID',
  'User-Agent',
];

describe('job ownership (MA08)', () => {
  it('GET /job/:id carries Bearer, session, visitor, request id and the app User-Agent', async () => {
    const h = await makeHarness();
    h.fetchReplies.push({
      status: 200,
      body: {
        id: 'job-1',
        status: 'processing',
        originalFile: { name: 'a.jpg', size: 1, type: 'image/jpeg' },
        options: {},
        createdAt: '2026-11-01T00:00:00Z',
      },
    });
    const r = await h.transport.fetchJob('job-1');
    expect(r.ok).toBe(true);
    const call = h.fetches[0]!;
    expect(call.url).toMatch(/\/job\/job-1$/);
    const { sessionId, visitorId } = h.store.getState().session;
    for (const k of OWNER) expect(call.init.headers[k]).toBeTruthy();
    expect(call.init.headers.Authorization).toBe('Bearer tok');
    expect(call.init.headers['X-MM-Session-ID']).toBe(sessionId);
    expect(call.init.headers['X-MM-Visitor-ID']).toBe(visitorId);
    expect(call.init.headers['User-Agent']).not.toMatch(/okhttp/i);
  });

  it('a 404 poll is an error with code not_found and does not invalidate Account', async () => {
    const h = await makeHarness();
    h.fetchReplies.push({ status: 404, body: { error: 'Job not found' } });
    const r = await h.transport.fetchJob('gone');
    expect(r).toMatchObject({ ok: false, error: { code: 'not_found', status: 404 } });
    expect(h.dispatched.some((a) => a.type.includes('invalidateTags'))).toBe(false);
  });

  it('SSE URL carries ?sid=<sessionId> and the owner headers', async () => {
    const h = await makeHarness();
    h.setStream(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: textStream([': keepalive\n\n']),
        text: () => Promise.resolve(''),
      }),
    );
    const onClose = new Promise<void>((resolve) => {
      h.transport.openJobEvents('job-9', {
        onSnapshot: jest.fn(),
        onActivity: jest.fn(),
        onError: jest.fn(),
        onClose: resolve,
      });
    });
    await onClose;
    const { sessionId } = h.store.getState().session;
    const call = h.streamCalls[0]!;
    expect(call.url).toMatch(/\/job\/job-9\/events\?sid=/);
    expect(new URL(call.url).searchParams.get('sid')).toBe(sessionId);
    expect(call.headers.Authorization).toBe('Bearer tok');
    expect(call.headers['X-MM-Session-ID']).toBe(sessionId);
    expect(call.headers.Accept).toBe('text/event-stream');
  });

  it('SSE: update events become snapshots, keepalives are activity, 404 is an error, close() silences', async () => {
    const job = {
      id: 'job-1',
      status: 'completed',
      originalFile: { name: 'a.jpg', size: 1, type: 'image/jpeg' },
      options: {},
      createdAt: '2026-11-01T00:00:00Z',
    };
    const h = await makeHarness();
    h.setStream(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: textStream([': keepalive\n\nevent: upd', `ate\ndata: ${JSON.stringify(job)}\n\n`]),
        text: () => Promise.resolve(''),
      }),
    );
    const got: string[] = [];
    await new Promise<void>((resolve) => {
      h.transport.openJobEvents('job-1', {
        onSnapshot: (j) => got.push(`snap:${j.status}`),
        onActivity: () => got.push('act'),
        onError: () => got.push('err'),
        onClose: resolve,
      });
    });
    expect(got).toContain('snap:completed');
    expect(got.filter((g) => g === 'act').length).toBeGreaterThan(0);

    h.setStream(() =>
      Promise.resolve({
        ok: false,
        status: 404,
        headers: { get: () => null },
        body: null,
        text: () => Promise.resolve('{"error":"Job not found"}'),
      }),
    );
    const err = await new Promise<{ code: string }>((resolve) => {
      h.transport.openJobEvents('x', {
        onSnapshot: jest.fn(),
        onActivity: jest.fn(),
        onError: resolve,
        onClose: jest.fn(),
      });
    });
    expect(err.code).toBe('not_found');

    const quiet = jest.fn();
    h.setStream(() => new Promise(() => undefined));
    const s = h.transport.openJobEvents('y', {
      onSnapshot: quiet,
      onActivity: quiet,
      onError: quiet,
      onClose: quiet,
    });
    s.close();
    await Promise.resolve();
    expect(quiet).not.toHaveBeenCalled();
  });
});
