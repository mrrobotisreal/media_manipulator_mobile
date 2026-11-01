import { higherTierFact } from '../tierFacts';
import { TIERS } from '../testFixtures';

describe('higherTierFact', () => {
  it('free: Premium and Pro tie on file size and video length', () => {
    expect(higherTierFact('maxFileBytes', TIERS, 'free')).toEqual({
      limitKey: 'maxFileBytes',
      tiers: ['premium', 'pro'],
      value: 5_368_709_120,
    });
    expect(higherTierFact('maxVideoSeconds', TIERS, 'free')?.tiers).toEqual(['premium', 'pro']);
  });

  it('free: output height names Premium first (Pro goes higher still)', () => {
    expect(higherTierFact('maxOutputHeight', TIERS, 'free')).toMatchObject({
      tiers: ['premium'],
      value: 1440,
    });
  });

  it('premium: only Pro, and only where Pro is higher', () => {
    expect(higherTierFact('maxFileBytes', TIERS, 'premium')).toBeNull();
    expect(higherTierFact('opsPerDay', TIERS, 'premium')).toEqual({
      limitKey: 'opsPerDay',
      tiers: ['pro'],
      value: 700,
    });
  });

  it('pro and operator get nothing', () => {
    expect(higherTierFact('opsPerDay', TIERS, 'pro')).toBeNull();
    expect(higherTierFact('opsPerDay', TIERS, 'operator')).toBeNull();
  });

  it('is null without data', () => {
    expect(higherTierFact('opsPerDay', undefined, 'free')).toBeNull();
    expect(higherTierFact('opsPerDay', TIERS, null)).toBeNull();
  });

  it('treats -1 as unlimited, above any number', () => {
    const t = TIERS.map((x) =>
      x.tier === 'pro' ? { ...x, limits: { ...x.limits, opsPerDay: -1 } } : x,
    );
    expect(higherTierFact('opsPerDay', t, 'premium')).toMatchObject({ tiers: ['pro'], value: -1 });
  });
});
