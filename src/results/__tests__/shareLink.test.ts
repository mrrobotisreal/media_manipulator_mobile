import { track } from '@/analytics/track';
import type { MmError } from '@/api/errors';
import {
  createAndCopyShareLink,
  revokeAllShareLinks,
  shareErrorCode,
  type ShareDeps,
} from '../shareLink';

jest.mock('@/analytics/track', () => ({ track: jest.fn() }));

const ctx = { jobId: 'job-1', toolSlug: 'image-converter', mediaKind: 'image' as const };
const err = (status: number, code: MmError['code']): MmError => ({ status, code, details: {} });
const deps = (over: Partial<ShareDeps> = {}): ShareDeps & Record<string, jest.Mock> =>
  ({
    create: jest.fn(async () => ({
      token: 't',
      url: 'https://media-manipulator.com/r/t',
      expiresAt: '2026-11-04T00:00:00Z',
    })),
    revoke: jest.fn(async () => ({ revoked: 3 })),
    copy: jest.fn(async () => undefined),
    ...over,
  }) as never;

beforeEach(() => (track as jest.Mock).mockClear());

describe('createAndCopyShareLink', () => {
  it('201: copies only the URL and emits share_link_copied {job_kind, source}', async () => {
    const d = deps();
    const r = await createAndCopyShareLink('job-1', 'gif', ctx, d);
    expect(r).toEqual({
      status: 'copied',
      url: 'https://media-manipulator.com/r/t',
      expiresAt: '2026-11-04T00:00:00Z',
    });
    expect(d.copy).toHaveBeenCalledWith('https://media-manipulator.com/r/t');
    expect(track).toHaveBeenCalledWith(
      'share_link_copied',
      { job_kind: 'image', source: 'result_panel' },
      expect.objectContaining({ job_id: 'job-1' }),
    );
  });

  it.each([
    [422, 'api:share_not_allowed', 'not_allowed'],
    [409, 'result_unavailable', 'unavailable'],
    [409, 'share_limit', 'limit'],
    [401, 'unauthenticated', 'unauthorized'],
    [404, 'not_found', 'not_found'],
    ['FETCH_ERROR', 'network', 'network'],
    [500, 'server_error', 'unknown'],
  ] as const)('%s %s -> %s, no event, nothing copied', async (status, code, want) => {
    const d = deps({
      create: jest.fn(async () => Promise.reject(err(status as number, code as MmError['code']))),
    });
    const r = await createAndCopyShareLink('job-1', 'image', ctx, d);
    expect(r).toEqual({ status: 'error', code: want });
    expect(d.copy).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });

  it('a clipboard failure is an error with no event', async () => {
    const d = deps({ copy: jest.fn(async () => Promise.reject(new Error('x'))) });
    expect(await createAndCopyShareLink('job-1', 'image', ctx, d)).toEqual({
      status: 'error',
      code: 'unknown',
    });
    expect(track).not.toHaveBeenCalled();
  });
});

describe('revokeAllShareLinks', () => {
  it('returns the revoked count', async () => {
    expect(await revokeAllShareLinks('job-1', deps())).toEqual({ status: 'revoked', count: 3 });
  });
  it('maps failures', async () => {
    const d = deps({ revoke: jest.fn(async () => Promise.reject(err(404, 'not_found'))) });
    expect(await revokeAllShareLinks('job-1', d)).toEqual({ status: 'error', code: 'not_found' });
  });
});

describe('shareErrorCode', () => {
  it('treats null as unknown', () => expect(shareErrorCode(null)).toBe('unknown'));
});
