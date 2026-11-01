// Ported from media-manipulator-ui lib/metadata/diff-model.ts @ f67c959 (web main). Keep in step with the web file.
/**
 * View model for the metadata diff modal (MM10): joins the server's DiffResult with the
 * original document into per-category rows. Pure.
 *
 * Expected changes (name, size, dates, type: `isExpectedChange`) always differ between an
 * input and its output, so they are reclassified as `expected` rather than `changed`: they
 * are not counted as changes and are drawn de-emphasized under the "Unchanged" filter.
 */
import { categoryOf, categoryRank } from './categories';
import { isExpectedChange, valueText } from './diff-text';
import type { DiffResult } from './diffResult';
import { privacyOf, type MetadataDocument, type MetadataEntry, type PrivacyClass } from './types';

export type DiffKind = 'removed' | 'added' | 'changed' | 'unchanged' | 'expected';

export interface DiffRow {
  kind: DiffKind;
  id: string;
  group: string;
  tag: string;
  category: string;
  privacy?: PrivacyClass;
  /** Text of the original-side value (empty for added rows). */
  before: string;
  /** Text of the result-side value (empty for removed rows). */
  after: string;
  /** Raw before/after for numeric deltas. */
  beforeRaw?: unknown;
  afterRaw?: unknown;
}

export interface DiffCategory {
  id: string;
  rows: DiffRow[];
  counts: { removed: number; added: number; changed: number; unchanged: number };
}

export interface DiffTotals {
  removed: number;
  added: number;
  changed: number;
  unchanged: number;
}

function splitId(id: string): { group: string; tag: string } {
  const base = id.includes('#') ? id.slice(0, id.indexOf('#')) : id;
  const i = base.indexOf(':');
  return i > 0 ? { group: base.slice(0, i), tag: base.slice(i + 1) } : { group: '', tag: base };
}

const rowOf = (kind: DiffKind, e: MetadataEntry, side: 'before' | 'after' | 'both'): DiffRow => {
  const text = valueText(e.value);
  return {
    kind,
    id: e.id,
    group: e.group,
    tag: e.tag,
    category: categoryOf(e),
    privacy: privacyOf(e),
    before: side === 'after' ? '' : text,
    after: side === 'before' ? '' : text,
    beforeRaw: side === 'after' ? undefined : e.value,
    afterRaw: side === 'before' ? undefined : e.value,
  };
};

export function buildDiffModel(
  diff: DiffResult,
  original: MetadataDocument | undefined,
): { categories: DiffCategory[]; totals: DiffTotals; categoryOfId: (id: string) => string } {
  const origById = new Map<string, MetadataEntry>();
  for (const e of original?.entries ?? []) if (!origById.has(e.id)) origById.set(e.id, e);
  const touched = new Set<string>();

  const rows: DiffRow[] = [];
  for (const e of diff.removed) {
    touched.add(e.id);
    rows.push(rowOf('removed', e, 'before'));
  }
  for (const e of diff.added) rows.push(rowOf('added', e, 'after'));
  for (const c of diff.changed) {
    touched.add(c.id);
    const o = origById.get(c.id);
    const { group, tag } = splitId(c.id);
    rows.push({
      kind: isExpectedChange(c.id) ? 'expected' : 'changed',
      id: c.id,
      group: o?.group ?? group,
      tag: o?.tag ?? tag,
      category: o ? categoryOf(o) : 'other',
      privacy: o ? privacyOf(o) : undefined,
      before: valueText(c.before),
      after: valueText(c.after),
      beforeRaw: c.before,
      afterRaw: c.after,
    });
  }
  for (const e of original?.entries ?? []) {
    if (touched.has(e.id)) continue;
    touched.add(e.id);
    rows.push(rowOf('unchanged', e, 'both'));
  }

  const map = new Map<string, DiffCategory>();
  const totals: DiffTotals = { removed: 0, added: 0, changed: 0, unchanged: 0 };
  const categoryById = new Map<string, string>();
  for (const r of rows) {
    categoryById.set(r.id, r.category);
    let cat = map.get(r.category);
    if (!cat) {
      cat = {
        id: r.category,
        rows: [],
        counts: { removed: 0, added: 0, changed: 0, unchanged: 0 },
      };
      map.set(r.category, cat);
    }
    cat.rows.push(r);
    const bucket = r.kind === 'expected' ? 'unchanged' : r.kind;
    cat.counts[bucket]++;
    totals[bucket]++;
  }
  // Server-side unchanged may exceed what the original document lists (e.g. it failed to load).
  const listedUnchanged =
    totals.unchanged - diff.changed.filter((c) => isExpectedChange(c.id)).length;
  if (diff.unchanged > listedUnchanged) totals.unchanged += diff.unchanged - listedUnchanged;

  const categories = [...map.values()].sort(
    (a, b) => categoryRank(a.id) - categoryRank(b.id) || a.id.localeCompare(b.id),
  );
  return { categories, totals, categoryOfId: (id) => categoryById.get(id) ?? 'other' };
}

/** "kept" for the result line: everything still present (unchanged + changed). */
export const keptCount = (diff: Pick<DiffResult, 'unchanged' | 'changed'>): number =>
  diff.unchanged + diff.changed.length;

/** True when a removed entry was location data (drives "including location"). */
export const removedLocation = (diff: Pick<DiffResult, 'removed'>): boolean =>
  diff.removed.some((e) => e.privacy === 'location');
