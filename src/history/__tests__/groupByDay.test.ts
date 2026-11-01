import { groupByDay } from '../groupByDay';

const e = (id: string, createdAt: string) => ({
  jobId: id,
  status: 'completed',
  createdAt,
  expired: false,
});

describe('groupByDay', () => {
  const now = new Date(2026, 10, 2, 12, 0, 0); // local Nov 2

  it('labels Today, Yesterday and older days; keeps order within a day', () => {
    const s = groupByDay(
      [
        e('a', new Date(2026, 10, 2, 9).toISOString()),
        e('b', new Date(2026, 10, 2, 8).toISOString()),
        e('c', new Date(2026, 10, 1, 23, 30).toISOString()),
        e('d', new Date(2026, 9, 20, 1).toISOString()),
      ],
      now,
    );
    expect(s.map((x) => x.kind)).toEqual(['today', 'yesterday', 'date']);
    expect(s[0]!.data.map((x) => x.jobId)).toEqual(['a', 'b']);
  });

  it('groups by calendar day across a DST boundary (23 h and 25 h days)', () => {
    // Local dates are constructed from components, so this holds in any TZ the runner uses.
    for (const [y, m, d] of [
      [2026, 2, 8],
      [2026, 9, 25],
      [2026, 10, 1],
    ] as const) {
      const noon = new Date(y, m, d, 12);
      const next = new Date(y, m, d + 1, 12);
      const s = groupByDay(
        [
          e('late', new Date(y, m, d + 1, 0, 30).toISOString()),
          e('early', new Date(y, m, d, 23, 30).toISOString()),
        ],
        next,
      );
      expect(s.map((x) => x.kind)).toEqual(['today', 'yesterday']);
      void noon;
    }
  });

  it('drops unparseable dates', () => {
    expect(groupByDay([e('x', 'nope')], now)).toEqual([]);
  });

  it.each(['ar-SA', 'he-IL'])('section dates format in %s', (locale) => {
    const [section] = groupByDay([e('a', new Date(2026, 9, 20, 1).toISOString())], now);
    const text = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(section!.date);
    expect(text).toMatch(/\S/);
    expect(section!.kind).toBe('date');
  });
});
