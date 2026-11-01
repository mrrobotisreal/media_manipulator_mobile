import * as analytics from '@/analytics/track';
import { maybeWarn, resetQuotaWarnings, shouldWarn } from '../quotaWarning';
import type { Allowance } from '../useAllowance';

const allowance = (metric: 'ops' | 'ai_ops', limit: number, remaining: number): Allowance => ({
  metric,
  limit,
  remaining,
  used: limit - remaining,
  unlimited: false,
  resetsAt: null,
  needsRefetch: false,
  source: 'snapshot',
});

describe('quota warning', () => {
  beforeEach(resetQuotaWarnings);

  it('20 % rule and the last-one rule, never at zero', () => {
    expect(shouldWarn(30, 7)).toBe(false);
    expect(shouldWarn(30, 6)).toBe(true);
    expect(shouldWarn(10, 2)).toBe(true);
    expect(shouldWarn(3, 1)).toBe(true);
    expect(shouldWarn(30, 0)).toBe(false);
    expect(shouldWarn(-1, 5)).toBe(false);
  });

  it('fires once per metric per session with catalog props', () => {
    const spy = jest.spyOn(analytics, 'track').mockImplementation(() => undefined);
    expect(maybeWarn(allowance('ops', 30, 6))).toBe(true);
    expect(maybeWarn(allowance('ops', 30, 5))).toBe(false);
    expect(maybeWarn(allowance('ai_ops', 10, 1))).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith('quota_warning_shown', {
      limit: 30,
      remaining: 6,
      scope: 'ops',
    });
    spy.mockRestore();
  });

  it('ignores unlimited and unknown', () => {
    expect(maybeWarn(null)).toBe(false);
    expect(maybeWarn({ ...allowance('ops', -1, Infinity), unlimited: true })).toBe(false);
  });
});
