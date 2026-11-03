import { EVENTS } from '@/analytics/events';
import type { MmError } from '@/api/errors';
import { track } from '@/analytics/track';
import { finishAccountDeletion, runAccountDeletion, type FinishDeps } from '../deleteAccount';
import {
  consentRecord,
  deleteAllFiles,
  deleteAnalyticsData,
  setAnalyticsOptOut,
  type DsrDeps,
} from '../privacy';
import { exportMyData } from '../exportFlow';
import { commitRetention, requestRetention } from '../useRetentionSave';
import { signOutEverywhere } from '../security';

jest.mock('@/analytics/track', () => ({ track: jest.fn() }));

const err = (code: string, status: number | string, details = {}): MmError =>
  ({ code, status, details }) as MmError;
const report = { status: 'completed' as const, steps: [], deleted: {} };

beforeEach(() => jest.clearAllMocks());

describe('retention save flow', () => {
  const preview = (n: number) => ({
    wouldDelete: { results: n, projects: 0, other: 0, bytes: 5 },
    earliestDeletionAt: null,
  });
  it('previewRetention is called only when shrinking', async () => {
    const p = jest.fn(async () => preview(0));
    const patch = jest.fn(async () => ({}));
    await requestRetention(8760, { current: 4320, preview: p, patch });
    expect(p).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith({ retentionHours: 8760 });
    await requestRetention(168, { current: 4320, preview: p, patch });
    expect(p).toHaveBeenCalledWith(168);
  });
  it('a shrink that would delete items asks to confirm and does not save until committed', async () => {
    const patch = jest.fn(async () => ({}));
    const out = await requestRetention(168, {
      current: 4320,
      preview: async () => preview(3),
      patch,
    });
    expect(out.status).toBe('confirm');
    expect(patch).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
    await commitRetention(168, { current: 4320, patch });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith(EVENTS.RETENTION_SETTING_CHANGED, {
      from_bucket: '6mo',
      to_bucket: '7d',
    });
  });
  it('a failed preview saves nothing; a failed save emits nothing', async () => {
    const patch = jest.fn(async () => ({}));
    expect(
      (
        await requestRetention(168, {
          current: 4320,
          preview: async () => {
            throw new Error('x');
          },
          patch,
        })
      ).status,
    ).toBe('previewFailed');
    expect(patch).not.toHaveBeenCalled();
    const bad = await commitRetention(24, {
      current: 4320,
      patch: async () => {
        throw new Error('x');
      },
    });
    expect(bad.status).toBe('saveFailed');
    expect(track).not.toHaveBeenCalled();
  });
});

describe('analytics opt-out and DSR', () => {
  it('opt-out sets analyticsOptOut and posts a consent record without blocking', async () => {
    const setOptOut = jest.fn();
    let release: () => void = () => {};
    const fetch = jest.fn(
      () =>
        new Promise<{ ok: boolean; status: number }>((r) => {
          release = () => r({ ok: true, status: 202 });
        }),
    );
    const now = () => new Date('2026-11-03T10:00:00Z');
    setAnalyticsOptOut(true, {
      setOptOut,
      visitorId: () => 'v-1',
      fetch,
      analyticsBaseUrl: 'https://an.test',
      now,
    });
    // the toggle applied synchronously while the POST is still pending
    expect(setOptOut).toHaveBeenCalledWith(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://an.test/v1/consent');
    expect(JSON.parse(init.body as string)).toEqual({
      visitor_id: 'v-1',
      occurred_at: '2026-11-03T10:00:00.000Z',
      mechanism: 'preferences',
      action: 'withdrawn',
      analytics: false,
      banner_version: 'app-1',
      policy_version: '2026-10-28',
    });
    release();
    expect(consentRecord('v', false).action).toBe('granted');
    expect(consentRecord('v', false).analytics).toBe(true);
  });

  it('a failing consent POST never throws into the toggle', () => {
    const setOptOut = jest.fn();
    expect(() =>
      setAnalyticsOptOut(false, {
        setOptOut,
        visitorId: () => 'v',
        fetch: () => Promise.reject(new Error('offline')),
        analyticsBaseUrl: 'x',
      }),
    ).not.toThrow();
    expect(setOptOut).toHaveBeenCalledWith(false);
    expect(() =>
      setAnalyticsOptOut(false, {
        setOptOut,
        visitorId: () => 'v',
        fetch: () => {
          throw new Error('sync');
        },
        analyticsBaseUrl: 'x',
      }),
    ).not.toThrow();
  });

  const dsr = (res: { ok: boolean; status: number } | 'throw', token: string | null = 'tok') => {
    const calls: string[] = [];
    const fetch = jest.fn(async (_u: string, _i: RequestInit) => {
      if (res === 'throw') throw new Error('offline');
      return res;
    });
    const deps: DsrDeps = {
      fetch,
      analyticsBaseUrl: 'https://an.test',
      idToken: async () => token,
      visitorId: () => 'visitor-9',
      discardQueued: () => void calls.push('discard'),
      resetAnalytics: () => void calls.push('reset'),
      rotateVisitor: () => void calls.push('rotate'),
    };
    return { deps, calls, fetch };
  };

  it('dsr delete sends Bearer + visitor_id then rotates visitorId', async () => {
    const { deps, calls, fetch } = dsr({ ok: true, status: 200 });
    expect(await deleteAnalyticsData(deps)).toBe(true);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://an.test/v1/dsr/delete');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toEqual({ visitor_id: 'visitor-9' });
    expect(calls).toEqual(['discard', 'reset', 'rotate']);
  });

  it('dsr delete rotates nothing on failure and never touches the opt-out flag', async () => {
    for (const res of [{ ok: false, status: 503 }, 'throw'] as const) {
      const { deps, calls } = dsr(res);
      expect(await deleteAnalyticsData(deps)).toBe(false);
      expect(calls).toEqual([]);
    }
  });
});

describe('delete all files', () => {
  it('deleteAllData sends confirm DELETE and emits data_deleted all/all_files', async () => {
    const wipeLocal = jest.fn();
    const trackFn = jest.fn();
    const out = await deleteAllFiles({
      deleteAll: async () => ({ pending: 0 }),
      track: trackFn,
      wipeLocal,
    });
    expect(out).toBe('deleted');
    expect(trackFn).toHaveBeenCalledWith(EVENTS.DATA_DELETED, { scope: 'all', kind: 'all_files' });
    expect(wipeLocal).toHaveBeenCalled();
    expect(
      await deleteAllFiles({ deleteAll: async () => ({ pending: 2 }), track: trackFn, wipeLocal }),
    ).toBe('pending');
  });
  it('a failed delete emits nothing and keeps the local cache', async () => {
    const trackFn = jest.fn();
    const wipeLocal = jest.fn();
    const out = await deleteAllFiles({
      deleteAll: async () => {
        throw new Error('x');
      },
      track: trackFn,
      wipeLocal,
    });
    expect(out).toBe('failed');
    expect(trackFn).not.toHaveBeenCalled();
    expect(wipeLocal).not.toHaveBeenCalled();
  });
});

describe('account deletion', () => {
  it('deleteAccount re-auths before the call and once more on reauth_required', async () => {
    const order: string[] = [];
    const replies = [
      { ok: false as const, error: err('reauth_required', 401) },
      { ok: true as const, report },
    ];
    const out = await runAccountDeletion({
      reauth: async () => (order.push('reauth'), true),
      call: async () => (order.push('call'), replies.shift()!),
      finish: async () => void order.push('finish'),
    });
    expect(order).toEqual(['reauth', 'call', 'reauth', 'call', 'finish']);
    expect(out).toEqual({ status: 'done' });
  });

  it('backing out of re-auth cancels without calling the API', async () => {
    const call = jest.fn();
    const out = await runAccountDeletion({
      reauth: async () => false,
      call,
      finish: async () => {},
    });
    expect(out.status).toBe('cancelled');
    expect(call).not.toHaveBeenCalled();
  });

  it('deleteAccount 502 keeps the report and offers retry', async () => {
    const rep = { status: 'incomplete', steps: [{ step: 'sweep', status: 'failed' }] };
    const finish = jest.fn();
    const out = await runAccountDeletion({
      reauth: async () => true,
      call: async () => ({ ok: false, error: err('server_error', 502, { report: rep }) }),
      finish,
    });
    expect(out).toEqual({ status: 'incomplete', report: rep });
    expect(finish).not.toHaveBeenCalled();
    // retry resumes: the same flow, now succeeding
    const again = await runAccountDeletion({
      reauth: async () => true,
      call: async () => ({ ok: true, report }),
      finish,
    });
    expect(again.status).toBe('done');
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('other failures surface as failed', async () => {
    const out = await runAccountDeletion({
      reauth: async () => true,
      call: async () => ({ ok: false, error: err('network', 'FETCH_ERROR') }),
      finish: async () => {},
    });
    expect(out.status).toBe('failed');
  });

  it('finishAccountDeletion orders: reset, rotate, event, flush, discard, sign out, wipe', async () => {
    const order: string[] = [];
    const d: FinishDeps = {
      resetAnalytics: () => void order.push('reset'),
      rotateVisitor: () => void order.push('rotate'),
      trackAccountDeleted: () => void order.push('track'),
      flushAnalytics: async () => void order.push('flush'),
      discardQueued: () => void order.push('discard'),
      signOutLocal: async () => void order.push('signOut'),
      wipeFiles: () => void order.push('files'),
      wipeStorage: () => void order.push('wipe'),
      resetState: () => void order.push('state'),
    };
    await finishAccountDeletion(d);
    expect(order).toEqual([
      'reset',
      'rotate',
      'track',
      'flush',
      'discard',
      'signOut',
      'files',
      'wipe',
      'state',
    ]);
  });
});

describe('export flow', () => {
  const file = {} as never;
  it('emits data_export_requested once the stream starts and shares the file', async () => {
    const share = jest.fn(async () => 'shared' as const);
    const out = await exportMyData({
      download: async () => ({ ok: true, file, fileName: 'x.zip' }),
      share,
    });
    expect(out.status).toBe('shared');
    expect(track).toHaveBeenCalledWith(EVENTS.DATA_EXPORT_REQUESTED, {});
  });
  it('429 reports retryAfterSeconds and emits nothing', async () => {
    const out = await exportMyData({
      download: async () => ({
        ok: false,
        error: err('export_rate_limited', 429, { retryAfterSeconds: 900 }),
      }),
      share: async () => 'shared',
    });
    expect(out).toEqual({ status: 'rate_limited', retryAfterSeconds: 900 });
    expect(track).not.toHaveBeenCalled();
  });
});

describe('sign out everywhere', () => {
  it('revokes first, then signs out; a failed revoke signs nobody out', async () => {
    const order: string[] = [];
    expect(
      await signOutEverywhere({
        revoke: async () => void order.push('revoke'),
        signOut: async () => void order.push('signOut'),
      }),
    ).toBe('done');
    expect(order).toEqual(['revoke', 'signOut']);
    const signOut = jest.fn();
    expect(
      await signOutEverywhere({
        revoke: async () => {
          throw new Error('x');
        },
        signOut,
      }),
    ).toBe('failed');
    expect(signOut).not.toHaveBeenCalled();
  });
});
