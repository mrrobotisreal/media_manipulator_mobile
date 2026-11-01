// Ported from media-manipulator-ui lib/metadata/search.ts @ f67c959 (web main). Keep in step with the web file.
/**
 * Search index over entries. Built once per document (the caller memoises it);
 * a query is whitespace-separated tokens, all of which must appear (AND) in the
 * entry's lowercase haystack of humanized name, raw tag, group, formatted value
 * and catalog description.
 */
import { formatValueText } from './format';
import { humanizeTag } from './humanize';
import type { MetadataEntry } from './types';

export interface SearchIndexItem {
  id: string;
  haystack: string;
}

export function buildSearchIndex(
  entries: readonly MetadataEntry[],
  opts: { locale?: string; describe?: (entry: MetadataEntry) => string | undefined } = {},
): SearchIndexItem[] {
  return entries.map((e) => ({
    id: e.id,
    haystack: [
      humanizeTag(e.tag),
      e.tag,
      e.group,
      formatValueText(e, opts.locale),
      opts.describe?.(e) ?? '',
    ]
      .join('\n')
      .toLowerCase(),
  }));
}

export function tokenize(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Ids of matching entries, or `null` when the query is empty (no filtering). */
export function searchEntries(
  index: readonly SearchIndexItem[],
  query: string,
): Set<string> | null {
  const tokens = tokenize(query);
  if (!tokens.length) return null;
  const out = new Set<string>();
  for (const item of index) {
    if (tokens.every((t) => item.haystack.includes(t))) out.add(item.id);
  }
  return out;
}
