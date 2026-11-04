import type { MakeTaskOptions } from '@/jobs/transport';
import { createPhotoProject, type CreateDeps } from '../projectCreate';
import { canonicalPhotoDoc, newPhotoDoc } from '../photoTypes';

const created = {
  project: { id: 'p1', name: 'IMG_1', revision: 1, status: 'ready', width: 4032, height: 3024 },
  doc: newPhotoDoc(4032, 3024),
};

function deps(replies: { status: number; body: unknown; headers?: Record<string, string> }[]) {
  const calls: { uri: string; url: string; opts: MakeTaskOptions }[] = [];
  const d: CreateDeps = {
    baseUrl: 'https://api.test/api',
    headers: async ({ forceRefresh }) => ({
      Authorization: forceRefresh ? 'Bearer fresh' : 'Bearer old',
    }),
    makeTask: (uri, url, opts) => {
      calls.push({ uri, url, opts });
      return {
        cancel: () => undefined,
        uploadAsync: async () => {
          opts.onProgress({ bytesSent: 42, totalBytes: 100 });
          const r = replies.shift()!;
          return { status: r.status, headers: r.headers ?? {}, body: JSON.stringify(r.body) };
        },
      };
    },
  };
  return { d, calls };
}

describe('createPhotoProject (multipart POST /photo/projects)', () => {
  it('uploads the file field with name + canonical doc, reports progress, parses {project, doc}', async () => {
    const { d, calls } = deps([{ status: 201, body: created }]);
    const progress: number[] = [];
    const doc = newPhotoDoc(4032, 3024);
    const r = await createPhotoProject(
      { fileUri: 'file:///x/IMG_1.jpg', mimeType: 'image/jpeg', name: 'IMG_1', doc },
      d,
      (f) => progress.push(f),
      new AbortController().signal,
    );
    expect(r).toMatchObject({ ok: true, response: { project: { id: 'p1', revision: 1 } } });
    expect(calls[0]!.url).toBe('https://api.test/api/photo/projects');
    expect(calls[0]!.opts).toMatchObject({
      method: 'POST',
      multipart: true,
      fieldName: 'file',
      mimeType: 'image/jpeg',
      parameters: { name: 'IMG_1', doc: canonicalPhotoDoc(doc) },
    });
    expect(progress).toEqual([0.42, 1]);
  });

  it('retries once with a fresh token on 401', async () => {
    const { d, calls } = deps([
      { status: 401, body: { error: 'unauthorized' } },
      { status: 201, body: created },
    ]);
    const r = await createPhotoProject(
      { fileUri: 'f', mimeType: 'image/jpeg' },
      d,
      () => undefined,
      new AbortController().signal,
    );
    expect(r.ok).toBe(true);
    expect(calls.map((c) => c.opts.headers.Authorization)).toEqual(['Bearer old', 'Bearer fresh']);
  });

  it('maps API refusals to MmError codes (project cap, too many pixels)', async () => {
    const { d } = deps([
      {
        status: 403,
        body: { error: 'photo_projects_limit', limit: 5, used: 5, upgradePath: 'premium' },
      },
      { status: 413, body: { error: 'photo_too_many_pixels', maxMegapixels: 120 } },
    ]);
    const a = await createPhotoProject(
      { fileUri: 'f', mimeType: 'image/jpeg' },
      d,
      () => undefined,
      new AbortController().signal,
    );
    expect(a).toMatchObject({
      ok: false,
      error: { status: 403, code: 'photo_projects_limit', details: { limit: 5 } },
    });
    const b = await createPhotoProject(
      { fileUri: 'f', mimeType: 'image/jpeg' },
      d,
      () => undefined,
      new AbortController().signal,
    );
    expect(b).toMatchObject({ ok: false, error: { status: 413, code: 'photo_too_many_pixels' } });
  });

  it('a 2xx with the wrong shape is a contract mismatch, not a crash', async () => {
    const { d } = deps([{ status: 201, body: { nope: true } }]);
    const r = await createPhotoProject(
      { fileUri: 'f', mimeType: 'image/jpeg' },
      d,
      () => undefined,
      new AbortController().signal,
    );
    expect(r).toMatchObject({ ok: false, error: { code: 'contract_mismatch' } });
  });
});
