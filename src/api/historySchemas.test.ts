import {
  historyEntrySchema,
  historyResponseSchema,
  keepLongerResponseSchema,
} from './schemas/history';

const base = { jobId: 'j1', status: 'completed', createdAt: '2026-11-01T10:00:00Z' };

describe('history schemas', () => {
  it('parses a local result with downloadPath + downloadAbsoluteUrl and ledger fields', () => {
    const e = historyEntrySchema.parse({
      ...base,
      tool: 'convert',
      mediaKind: 'image',
      sourceFormat: 'jpg',
      targetFormat: 'png',
      expired: false,
      resultFileName: 'a.png',
      downloadPath: '/download/j1',
      downloadAbsoluteUrl: 'https://api.example.test/api/download/j1',
      retainedObjectId: 'r1',
      deletesOn: '2026-11-08T10:00:00Z',
      keptLonger: true,
      metadataAvailable: { result: true },
    });
    expect(e.downloadAbsoluteUrl).toContain('/api/download/j1');
    expect(e.keptLonger).toBe(true);
  });

  it('parses a downloadPath-only row (pre-MA08 server)', () => {
    const e = historyEntrySchema.parse({ ...base, expired: false, downloadPath: '/download/j1' });
    expect(e.downloadAbsoluteUrl).toBeUndefined();
  });

  it('parses an S3 downloadUrl row', () => {
    expect(
      historyEntrySchema.parse({ ...base, downloadUrl: 'https://s3.example/x?sig=1' }).downloadUrl,
    ).toMatch(/^https/);
  });

  it('parses an expired row and defaults expired to false when absent', () => {
    expect(historyEntrySchema.parse({ ...base, expired: true }).expired).toBe(true);
    expect(historyEntrySchema.parse(base).expired).toBe(false);
  });

  it('accepts an unknown status and passes unknown keys through', () => {
    const e = historyEntrySchema.parse({ ...base, status: 'quarantined', aFutureKey: 7 });
    expect(e.status).toBe('quarantined');
    expect((e as Record<string, unknown>).aFutureKey).toBe(7);
  });

  it('rejects a row with no jobId', () => {
    expect(historyEntrySchema.safeParse({ status: 'completed', createdAt: 'x' }).success).toBe(
      false,
    );
  });

  it('parses the page envelope', () => {
    const r = historyResponseSchema.parse({ entries: [base], total: 120, limit: 50, offset: 0 });
    expect(r.total).toBe(120);
    expect(historyResponseSchema.parse({ entries: [], total: 0 }).entries).toEqual([]);
  });

  it('parses the keep-longer 200', () => {
    const r = keepLongerResponseSchema.parse({
      keepForHours: 720,
      expiresAt: '2026-12-01T00:00:00Z',
      keptLonger: true,
      updated: 1,
    });
    expect(r.expiresAt).toBe('2026-12-01T00:00:00Z');
  });
});
