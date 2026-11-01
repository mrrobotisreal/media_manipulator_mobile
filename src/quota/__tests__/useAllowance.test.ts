import { mergeAllowance } from '../useAllowance';
import { SNAPSHOT } from '../testFixtures';

const NOW = Date.parse('2026-11-02T12:00:00Z');
const FETCHED = NOW - 60_000;
const hdr = (remaining: number, over = {}) => ({
  limit: 30,
  remaining,
  resetAt: '2026-11-03T00:00:00Z',
  observedAt: FETCHED + 30_000,
  ...over,
});

describe('mergeAllowance', () => {
  it('uses the snapshot alone', () => {
    const a = mergeAllowance('ops', {
      snapshot: SNAPSHOT,
      fetchedAt: FETCHED,
      headers: {},
      now: NOW,
    });
    expect(a).toMatchObject({
      limit: 30,
      used: 24,
      remaining: 6,
      source: 'snapshot',
      needsRefetch: false,
    });
  });

  it('newer headers win', () => {
    const a = mergeAllowance('ops', {
      snapshot: SNAPSHOT,
      fetchedAt: FETCHED,
      headers: { ops: hdr(2) },
      now: NOW,
    });
    expect(a).toMatchObject({ used: 28, remaining: 2, source: 'headers' });
  });

  it('older headers are ignored', () => {
    const a = mergeAllowance('ops', {
      snapshot: SNAPSHOT,
      fetchedAt: FETCHED,
      headers: { ops: hdr(2, { observedAt: FETCHED - 1 }) },
      now: NOW,
    });
    expect(a).toMatchObject({ used: 24, source: 'snapshot' });
  });

  it('headers alone work before the snapshot loads', () => {
    const a = mergeAllowance('ai_ops', {
      headers: { ai_ops: hdr(3, { limit: 10 }) },
      now: NOW,
    });
    expect(a).toMatchObject({ limit: 10, used: 7, source: 'headers' });
  });

  it('unlimited (-1) has no used/limit pressure', () => {
    const a = mergeAllowance('ops', {
      snapshot: { ...SNAPSHOT, limits: { ...SNAPSHOT.limits, opsPerDay: -1 } },
      fetchedAt: FETCHED,
      headers: {},
      now: NOW,
    });
    expect(a).toMatchObject({ unlimited: true, remaining: Infinity });
  });

  it('a reset in the past counts as unused and asks for a refetch', () => {
    const a = mergeAllowance('ops', {
      snapshot: { ...SNAPSHOT, resetsAt: '2026-11-02T00:00:00Z' },
      fetchedAt: FETCHED,
      headers: {},
      now: NOW,
    });
    expect(a).toMatchObject({ used: 0, needsRefetch: true });
  });

  it('expired headers are ignored', () => {
    const a = mergeAllowance('ops', {
      snapshot: SNAPSHOT,
      fetchedAt: FETCHED,
      headers: { ops: hdr(0, { resetAt: '2026-11-02T00:00:00Z' }) },
      now: NOW,
    });
    expect(a?.source).toBe('snapshot');
  });

  it('null when nothing is known', () => {
    expect(mergeAllowance('ops', { headers: {}, now: NOW })).toBeNull();
  });
});
