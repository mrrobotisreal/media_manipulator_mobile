import jpeg from '@/metadata/__fixtures__/inspect-jpeg-gps.json';
import mov from '@/metadata/__fixtures__/inspect-mov.json';
import pdf from '@/metadata/__fixtures__/inspect-pdf.json';
import { diffResultSchema } from '@/metadata/diffResult';
import { metadataDocumentSchema } from '@/metadata/types';
import type { MakeTaskOptions } from '@/jobs/transport';
import { makeHarness, teardownHarness } from '@/jobs/transportHarness';
import { diffUnavailableReason, inspectFile, metadataApi } from '../metadata';

afterEach(teardownHarness);

function fakeTask(replies: { status: number; body?: unknown }[]) {
  const calls: { uri: string; url: string; opts: MakeTaskOptions }[] = [];
  const makeTask = (uri: string, url: string, opts: MakeTaskOptions) => {
    calls.push({ uri, url, opts });
    return {
      cancel: jest.fn(),
      uploadAsync: async () => {
        const r = replies.shift() ?? { status: 500 };
        return {
          status: r.status,
          headers: {},
          body: r.body === undefined ? '' : JSON.stringify(r.body),
        };
      },
    };
  };
  return { calls, makeTask };
}
const headers = () => Promise.resolve({ Authorization: 'Bearer tok' });

describe('metadata inspect fixtures', () => {
  it('parse the recorded API documents (jpeg, mov, pdf)', () => {
    for (const f of [jpeg, mov, pdf]) {
      const r = metadataDocumentSchema.safeParse(f);
      expect(r.success).toBe(true);
    }
    expect(metadataDocumentSchema.parse(jpeg).entries.length).toBe(35);
  });
  it('tolerates null entries/tools/warnings like the Go nil slices', () => {
    const doc = metadataDocumentSchema.parse({
      schemaVersion: 1,
      file: { name: 'a', sizeBytes: 1, mime: 'x', kind: 'image' },
      entries: null,
      tools: null,
      warnings: null,
    });
    expect(doc.entries).toEqual([]);
  });
});

describe('inspectFile', () => {
  it('POSTs the multipart field "file" to /metadata/inspect and parses the document', async () => {
    const { calls, makeTask } = fakeTask([{ status: 200, body: jpeg }]);
    const r = await inspectFile(
      { fileUri: 'file:///c/a.jpg', mimeType: 'image/jpeg' },
      { makeTask, buildHeaders: headers, baseUrl: 'https://api.test/api' },
    );
    expect(r.ok && r.document.entries.length).toBe(35);
    expect(calls[0]!.url).toBe('https://api.test/api/metadata/inspect');
    expect(calls[0]!.opts).toMatchObject({
      method: 'POST',
      multipart: true,
      fieldName: 'file',
      mimeType: 'image/jpeg',
    });
    expect(calls[0]!.opts.parameters).toBeUndefined();
  });
  it('a malformed body becomes contract_mismatch', async () => {
    const { makeTask } = fakeTask([{ status: 200, body: { schemaVersion: 'x' } }]);
    const r = await inspectFile(
      { fileUri: 'file:///c/a.jpg', mimeType: 'image/jpeg' },
      { makeTask, buildHeaders: headers, baseUrl: 'https://api.test/api' },
    );
    expect(r).toMatchObject({ ok: false, error: { code: 'contract_mismatch' } });
  });
  it('a 400 is bad_request and a 401 retries once with a refreshed token', async () => {
    const bad = fakeTask([{ status: 400, body: { error: 'no file provided' } }]);
    const r = await inspectFile(
      { fileUri: 'file:///c/a.jpg', mimeType: 'image/jpeg' },
      { makeTask: bad.makeTask, buildHeaders: headers },
    );
    expect(r).toMatchObject({ ok: false, error: { code: 'bad_request', status: 400 } });
    const retry = fakeTask([
      { status: 401, body: {} },
      { status: 200, body: pdf },
    ]);
    const ok = await inspectFile(
      { fileUri: 'file:///c/a.pdf', mimeType: 'application/pdf' },
      { makeTask: retry.makeTask, buildHeaders: headers },
    );
    expect(ok.ok).toBe(true);
    expect(retry.calls).toHaveLength(2);
  });
  it('a thrown upload is a network error', async () => {
    const makeTask = () => ({
      cancel: jest.fn(),
      uploadAsync: () => Promise.reject(new Error('boom')),
    });
    const r = await inspectFile(
      { fileUri: 'file:///c/a.jpg', mimeType: 'image/jpeg' },
      { makeTask, buildHeaders: headers },
    );
    expect(r).toMatchObject({ ok: false, error: { code: 'network' } });
  });
});

describe('diff schema and 409 mapping', () => {
  it('parses a diff fixture, defaulting null lists', () => {
    const d = diffResultSchema.parse({
      removed: [
        { id: 'GPS:GPSLatitude', group: 'GPS', tag: 'GPSLatitude', value: 1, category: 'gps' },
      ],
      added: null,
      changed: [{ id: 'File:FileSize', before: '2 MB', after: '1 MB' }],
      unchanged: 7,
      byCategory: { gps: { removed: 1, added: 0, changed: 0, unchanged: 0 } },
    });
    expect(d.added).toEqual([]);
    expect(d.removed).toHaveLength(1);
  });
  it('maps the three English 409 strings', () => {
    const e = (message: string) => ({ status: 409, code: 'conflict', message, details: {} });
    expect(diffUnavailableReason(e('Job not completed'))).toBe('jobNotCompleted');
    expect(diffUnavailableReason(e('Result file not available'))).toBe('resultMissing');
    expect(diffUnavailableReason(e('Result has no comparable metadata'))).toBe('notComparable');
    expect(diffUnavailableReason({ status: 404 })).toBeUndefined();
  });
  it('GET /job/:id/metadata/diff carries owner headers and surfaces a 409 as an error', async () => {
    const h = await makeHarness();
    h.fetchReplies.push({ status: 409, body: { error: 'Result has no comparable metadata' } });
    const r = await h.store.dispatch(metadataApi.endpoints.getJobMetadataDiff.initiate('j1'));
    expect(h.fetches[0]!.url).toMatch(/\/job\/j1\/metadata\/diff$/);
    expect(h.fetches[0]!.init.headers.Authorization).toBe('Bearer tok');
    expect(diffUnavailableReason(r.error)).toBe('notComparable');
  });
  it('GET /job/:id/metadata?side= parses a document', async () => {
    const h = await makeHarness();
    h.fetchReplies.push({ status: 200, body: pdf });
    const r = await h.store.dispatch(
      metadataApi.endpoints.getJobMetadata.initiate({ jobId: 'j1', side: 'result' }),
    );
    expect(h.fetches[0]!.url).toMatch(/\/job\/j1\/metadata\?side=result$/);
    expect(r.data?.file.kind).toBe('document');
  });
});
