// Ported from media-manipulator-ui lib/metadata/rows.ts @ f67c959 (web main). Keep in step with the web file.
/**
 * Joins entries with catalog descriptions and formatted values into display rows.
 * Built once per (document, catalog, language) by the inspector.
 */
import { lookupTag, type CatalogIndex, type CatalogTag } from './catalog';
import { categoryOf } from './categories';
import { formatValue, formatValueText, type FormattedValue } from './format';
import { humanizeTag, streamLabel } from './humanize';
import type { MetadataEntry } from './types';

export interface RowAbout {
  text: string;
  unverified: boolean;
  aliases: string[];
}

export interface MetadataRow {
  entry: MetadataEntry;
  category: string;
  label: string;
  groupLabel: string;
  about: RowAbout | undefined;
  formatted: FormattedValue;
  text: string;
}

export interface BuildRowsOptions {
  catalog: CatalogIndex;
  /** Returns the localized description for a catalog row (falls back to the row's English text). */
  describe: (row: CatalogTag) => string;
  locale?: string;
}

export function buildRows(
  entries: readonly MetadataEntry[],
  opts: BuildRowsOptions,
): MetadataRow[] {
  const streamTypes = new Map<string, string>();
  for (const e of entries) {
    if (e.tag === 'StreamType' && typeof e.value === 'string') streamTypes.set(e.group, e.value);
  }
  return entries.map((entry) => {
    const category = categoryOf(entry);
    const row = lookupTag(opts.catalog, entry.group, entry.tag, entry.category);
    return {
      entry,
      category,
      label: humanizeTag(entry.tag),
      groupLabel: streamLabel(entry.group, streamTypes.get(entry.group)),
      about: row
        ? { text: opts.describe(row), unverified: row.unverified, aliases: row.aliases }
        : undefined,
      formatted: formatValue(entry, opts.locale),
      text: formatValueText(entry, opts.locale),
    };
  });
}
