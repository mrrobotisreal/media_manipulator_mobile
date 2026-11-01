import type { HistoryEntry } from '@/api/schemas/history';

export interface DaySection {
  /** Local `yyyy-m-d`. */
  key: string;
  kind: 'today' | 'yesterday' | 'date';
  /** Local midnight of the day. */
  date: Date;
  data: HistoryEntry[];
}

const keyOf = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/**
 * Groups entries by the local calendar day of `createdAt` (server order is kept inside a day). Day math uses
 * calendar components, never `24 h` offsets, so a DST day of 23 or 25 hours still groups correctly.
 * Entries with an unparseable `createdAt` are dropped.
 */
export function groupByDay(entries: readonly HistoryEntry[], now: Date = new Date()): DaySection[] {
  const todayKey = keyOf(now);
  const yesterdayKey = keyOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const sections: DaySection[] = [];
  const byKey = new Map<string, DaySection>();
  for (const e of entries) {
    const at = new Date(e.createdAt);
    if (Number.isNaN(at.getTime())) continue;
    const key = keyOf(at);
    let section = byKey.get(key);
    if (!section) {
      section = {
        key,
        kind: key === todayKey ? 'today' : key === yesterdayKey ? 'yesterday' : 'date',
        date: new Date(at.getFullYear(), at.getMonth(), at.getDate()),
        data: [],
      };
      byKey.set(key, section);
      sections.push(section);
    }
    section.data.push(e);
  }
  return sections;
}
