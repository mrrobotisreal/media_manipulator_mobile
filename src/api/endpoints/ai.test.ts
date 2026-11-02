import { detectFaces, type DetectDeps } from './ai';

const OK = {
  faceDetectionSessionId: 'fd_1',
  imageWidth: 1000,
  imageHeight: 800,
  expiresAt: '2026-11-02T12:30:00Z',
  faces: [{ id: 'face_1', x: 0.1, y: 0.1, width: 0.2, height: 0.2 }],
};

function deps(reply: { status: number; body: unknown }, seen: { opts?: unknown; url?: string } = {}) {
  return {
    buildHeaders: async () => ({ Authorization: 'Bearer t', 'X-MM-Session-ID': 's' }),
    baseUrl: 'https://api.test/api',
    makeTask: (_uri: string, url: string, opts: unknown) => {
      seen.url = url;
      seen.opts = opts;
      return {
        uploadAsync: async () => ({
          status: reply.status,
          headers: {},
          body: typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body),
        }),
        cancel: jest.fn(),
      };
    },
  } as DetectDeps;
}

describe('detectFaces (POST /ai/faces/detect)', () => {
  it('uploads multipart field "file" with the standard headers and parses the response', async () => {
    const seen: { opts?: { fieldName: string; headers: Record<string, string> }; url?: string } = {};
    const res = await detectFaces({ uri: 'file:///a.jpg', mimeType: 'image/jpeg' }, deps({ status: 200, body: OK }, seen));
    expect(seen.url).toBe('https://api.test/api/ai/faces/detect');
    expect(seen.opts?.fieldName).toBe('file');
    expect(seen.opts?.headers.Authorization).toBe('Bearer t');
    expect(res.ok && res.data.faces).toHaveLength(1);
    expect(res.ok && res.data.faceDetectionSessionId).toBe('fd_1');
  });

  it('a null faces array is zero faces', async () => {
    const res = await detectFaces({ uri: 'f', mimeType: 'image/png' }, deps({ status: 200, body: { ...OK, faces: null } }));
    expect(res.ok && res.data.faces).toEqual([]);
  });

  it('a malformed 200 is contract_mismatch', async () => {
    const res = await detectFaces({ uri: 'f', mimeType: 'image/png' }, deps({ status: 200, body: { faces: 5 } }));
    expect(!res.ok && res.error.code).toBe('contract_mismatch');
  });

  it('maps 400, 429 and 503 through the shared error normaliser', async () => {
    const bad = await detectFaces({ uri: 'f', mimeType: 'x' }, deps({ status: 400, body: { error: 'Face detection only supports image files' } }));
    expect(!bad.ok && bad.error.code).toBe('bad_request');
    const rl = await detectFaces(
      { uri: 'f', mimeType: 'x' },
      deps({ status: 429, body: { error: 'slow down', retryAfterSeconds: 30, scope: 'analysis' } }),
    );
    expect(!rl.ok && rl.error.code).toBe('rate_limited');
    const off = await detectFaces({ uri: 'f', mimeType: 'x' }, deps({ status: 503, body: { error: 'AI service is not enabled' } }));
    expect(!off.ok && off.error.code).toBe('server_error');
  });

  it('a thrown upload is a network error, not a crash', async () => {
    const d = deps({ status: 200, body: OK });
    d.makeTask = () => {
      throw new Error('boom');
    };
    const res = await detectFaces({ uri: 'f', mimeType: 'x' }, d);
    expect(!res.ok && res.error.code).toBe('network');
  });
});
