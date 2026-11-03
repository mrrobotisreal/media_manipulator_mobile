import type { File } from 'expo-file-system';
import { downloadExport, exportFileName, type ExportDeps } from '../exportData';

function fakeFile() {
  const written: Uint8Array[] = [];
  const file = {
    exists: false,
    delete: jest.fn(),
    create: jest.fn(),
    writableStream: () =>
      new WritableStream<Uint8Array>({
        write(chunk) {
          written.push(chunk);
        },
      }),
  } as unknown as File;
  return { file, written };
}

function deps(
  res: Partial<Awaited<ReturnType<ExportDeps['fetch']>>> & { status: number },
  f = fakeFile(),
) {
  const seen: { url?: string } = {};
  const d: ExportDeps = {
    buildHeaders: async () => ({ Authorization: 'Bearer t' }),
    baseUrl: 'https://api.test/api',
    fileFor: jest.fn(() => f.file),
    fetch: async (url) => {
      seen.url = url;
      return {
        ok: res.status >= 200 && res.status < 300,
        headers: { get: () => null },
        body: null,
        text: async () => '',
        ...res,
      };
    },
  };
  return { d, seen, f };
}

describe('exportData', () => {
  it('exportData names the file from Content-Disposition', async () => {
    expect(exportFileName('attachment; filename="mm-data-export-2026-11-03.zip"')).toBe(
      'mm-data-export-2026-11-03.zip',
    );
    expect(exportFileName(null)).toBe('mm-data-export.zip');
    expect(exportFileName('attachment; filename="../../etc/x.zip"')).toBe('x.zip');

    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([1, 2, 3]));
        c.close();
      },
    });
    const { d, seen, f } = deps({
      status: 200,
      headers: {
        get: (n) => (n === 'Content-Disposition' ? 'attachment; filename="export-7.zip"' : null),
      },
      body: stream,
    });
    const r = await downloadExport(d);
    expect(seen.url).toBe('https://api.test/api/account/data/export');
    expect(d.fileFor).toHaveBeenCalledWith('export-7.zip');
    expect(r).toMatchObject({ ok: true, fileName: 'export-7.zip' });
    expect(f.written).toHaveLength(1);
  });

  it('exportData handles 429 retryAfterSeconds', async () => {
    const { d } = deps({
      status: 429,
      text: async () => JSON.stringify({ error: 'export_rate_limited', retryAfterSeconds: 1800 }),
    });
    const r = await downloadExport(d);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('export_rate_limited');
      expect(r.error.details.retryAfterSeconds).toBe(1800);
    }
  });

  it('a transport failure is a network error and removes the partial file', async () => {
    const d: ExportDeps = {
      ...deps({ status: 200 }).d,
      fetch: async () => {
        throw new Error('offline');
      },
    };
    const r = await downloadExport(d);
    expect(r).toMatchObject({ ok: false, error: { code: 'network' } });
  });
});
