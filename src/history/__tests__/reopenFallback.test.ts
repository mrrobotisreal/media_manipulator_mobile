import {
  clearEntryCache,
  directDownloadFor,
  PRESIGNED_TRUST_MS,
  rememberEntry,
} from '../entryCache';
import { jobFromEntry, linkForJob, reopenableEntry } from '../reopenFallback';
import { trackHistoryItemReopened } from '@/analytics/historyEvents';
import { reopenAgeBucket } from '../entryRules';
import { track } from '@/analytics/track';

jest.mock('@/analytics/track', () => ({ track: jest.fn() }));

const ORIGIN = 'https://api.example.test';
const entry = (over = {}) => ({
  jobId: 'j1',
  status: 'completed',
  createdAt: '2026-11-01T10:00:00Z',
  expired: false,
  resultFileName: 'out.png',
  deletesOn: '2026-11-08T10:00:00Z',
  ...over,
});

beforeEach(() => {
  clearEntryCache();
  (track as jest.Mock).mockClear();
});

describe('download URL precedence', () => {
  it('downloadAbsoluteUrl > downloadUrl > origin + downloadPath', () => {
    const all = entry({
      downloadAbsoluteUrl: `${ORIGIN}/api/download/j1`,
      downloadUrl: 'https://s3.example/x?sig=1',
      downloadPath: '/download/j1',
    });
    expect(directDownloadFor(all as never, 0, ORIGIN)?.source).toBe('downloadAbsoluteUrl');
    expect(
      directDownloadFor({ ...all, downloadAbsoluteUrl: undefined } as never, 0, ORIGIN),
    ).toMatchObject({
      source: 'downloadUrl',
      ownerHeaders: false,
    });
    expect(
      directDownloadFor(
        { ...all, downloadAbsoluteUrl: undefined, downloadUrl: undefined } as never,
        0,
        ORIGIN,
      ),
    ).toEqual({ url: `${ORIGIN}/api/download/j1`, source: 'downloadPath', ownerHeaders: true });
  });

  it('never trusts a presigned URL past its freshness window, falls through to the path then to null', () => {
    const e = entry({ downloadUrl: 'https://s3.example/x', downloadPath: '/download/j1' });
    expect(directDownloadFor(e as never, PRESIGNED_TRUST_MS + 1, ORIGIN)?.source).toBe(
      'downloadPath',
    );
    expect(
      directDownloadFor(
        entry({ downloadUrl: 'https://s3.example/x' }) as never,
        PRESIGNED_TRUST_MS + 1,
        ORIGIN,
      ),
    ).toBeNull();
  });

  it('expired or unfinished rows have no direct download', () => {
    expect(
      directDownloadFor(entry({ expired: true, downloadPath: '/d' }) as never, 0, ORIGIN),
    ).toBeNull();
    expect(
      directDownloadFor(entry({ status: 'failed', downloadPath: '/d' }) as never, 0, ORIGIN),
    ).toBeNull();
  });
});

describe('linkForJob (result screen fallback)', () => {
  it('uses the remembered entry URL and does not mint', async () => {
    rememberEntry(entry({ downloadAbsoluteUrl: `${ORIGIN}/api/download/j1` }) as never);
    const mint = jest.fn();
    const link = await linkForJob('j1', mint);
    expect(link.absoluteUrl).toBe(`${ORIGIN}/api/download/j1`);
    expect(mint).not.toHaveBeenCalled();
  });

  it('mints a link when nothing is remembered or the entry has no URL', async () => {
    const minted = {
      url: '/download/j1?token=t',
      absoluteUrl: `${ORIGIN}/api/download/j1?token=t`,
    };
    const mint = jest.fn().mockResolvedValue(minted);
    expect(await linkForJob('j1', mint)).toBe(minted);
    rememberEntry(entry() as never);
    expect(await linkForJob('j1', mint)).toBe(minted);
    expect(mint).toHaveBeenCalledTimes(2);
  });

  it('a stale presigned entry falls through to minting', async () => {
    rememberEntry(entry({ downloadUrl: 'https://s3.example/x' }) as never, 0);
    const mint = jest.fn().mockResolvedValue({ url: '/u' });
    await linkForJob('j1', mint, PRESIGNED_TRUST_MS + 5);
    expect(mint).toHaveBeenCalled();
  });
});

describe('descriptor from a history entry', () => {
  it('builds a completed job with file name, expiry and metadata flags', () => {
    const job = jobFromEntry(entry({ metadataAvailable: { result: true } }) as never);
    expect(job).toMatchObject({
      id: 'j1',
      status: 'completed',
      resultFileName: 'out.png',
      expiresAt: '2026-11-08T10:00:00Z',
      metadataAvailable: { result: true },
    });
  });

  it('only completed, unexpired entries are reopenable', () => {
    rememberEntry(entry() as never);
    rememberEntry(entry({ jobId: 'x', expired: true }) as never);
    expect(reopenableEntry('j1')).toBeDefined();
    expect(reopenableEntry('x')).toBeUndefined();
    expect(reopenableEntry('missing')).toBeUndefined();
  });
});

describe('history_item_reopened', () => {
  it('emits kind, age_bucket and source: account', () => {
    const now = Date.parse('2026-11-04T10:00:00Z');
    trackHistoryItemReopened(entry({ mediaKind: 'image' }) as never, now);
    expect(track).toHaveBeenCalledWith('history_item_reopened', {
      kind: 'image',
      age_bucket: '1-7d',
      source: 'account',
    });
  });

  it('buckets match the web helper', () => {
    const d = 86_400_000;
    expect([0, d, 7 * d, 30 * d, 90 * d].map(reopenAgeBucket)).toEqual([
      '<1d',
      '1-7d',
      '7-30d',
      '30-90d',
      '90d+',
    ]);
  });
});
