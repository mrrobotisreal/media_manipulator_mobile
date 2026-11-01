import { claimActivation } from '../runtime';
import { hoursSinceSignupBucket } from '@/analytics/jobEvents';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));

describe('activation flag', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => Promise.resolve(m.get(k)),
      setItem: (k: string, v: string) => {
        m.set(k, v);
        return Promise.resolve(true);
      },
    };
  };
  it('claims once per uid', async () => {
    const s = mem();
    expect(await claimActivation('a', s)).toBe(true);
    expect(await claimActivation('a', s)).toBe(false);
    expect(await claimActivation('b', s)).toBe(true);
  });
  it('survives corrupt storage', async () => {
    const s = mem();
    await s.setItem('mm.activated', '{oops');
    expect(await claimActivation('a', s)).toBe(true);
  });
  it('buckets hours since signup like the web', () => {
    const h = 3_600_000;
    expect([0.5 * h, 2 * h, 30 * h, 200 * h].map(hoursSinceSignupBucket)).toEqual([
      '<1h',
      '1-24h',
      '1-7d',
      '7d+',
    ]);
  });
});
