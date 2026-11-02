// Ported from media-manipulator-ui lib/metadata/categories.ts @ f67c959 (web main). Keep in step with the web file.
/**
 * Category ordering, defaults and the client override table.
 *
 * The server assigns `entry.category`; `CATEGORY_OVERRIDES` lets the UI move a
 * specific `group:tag` (or whole group, key `group:*`) without an API change.
 * Empty by default.
 */
import { CATEGORY_ORDER, type MetadataEntry, type PrivacyClass, privacyOf } from './types';

export const CATEGORY_OVERRIDES: Readonly<Record<string, string>> = {};

export function categoryOf(entry: Pick<MetadataEntry, 'group' | 'tag' | 'category'>): string {
  return (
    CATEGORY_OVERRIDES[`${entry.group}:${entry.tag}`] ??
    CATEGORY_OVERRIDES[`${entry.group}:*`] ??
    entry.category ??
    'other'
  );
}

/** Position in design-section-3.3 order; unknown ids sort after `other`. */
export function categoryRank(id: string): number {
  const i = (CATEGORY_ORDER as readonly string[]).indexOf(id);
  return i === -1 ? CATEGORY_ORDER.length : i;
}

export interface CategoryGroup {
  id: string;
  entries: MetadataEntry[];
  /** Highest-priority privacy class present, for the header badge. */
  privacy: PrivacyClass[];
}

/** Groups entries by category in display order, preserving entry order inside a group. */
export function groupByCategory(entries: readonly MetadataEntry[]): CategoryGroup[] {
  const map = new Map<string, MetadataEntry[]>();
  for (const e of entries) {
    const id = categoryOf(e);
    const list = map.get(id);
    if (list) list.push(e);
    else map.set(id, [e]);
  }
  return [...map.entries()]
    .sort((a, b) => categoryRank(a[0]) - categoryRank(b[0]) || a[0].localeCompare(b[0]))
    .map(([id, list]) => ({
      id,
      entries: list,
      privacy: [...new Set(list.map(privacyOf).filter((p): p is PrivacyClass => !!p))],
    }));
}

/** Entries that are only basic file info (File/System group or the Format summary). */
export function isBasicFileEntry(entry: Pick<MetadataEntry, 'group'>): boolean {
  return entry.group === 'File' || entry.group === 'System' || entry.group === 'Format';
}

/** True when the document carries nothing beyond basic file information. */
export function hasOnlyBasicInfo(entries: readonly MetadataEntry[]): boolean {
  return entries.every(isBasicFileEntry);
}

/** Default-open categories: file, the media-type category, camera, and gps when present. */
export function defaultOpen(present: ReadonlySet<string>): string[] {
  return ['file', 'image', 'video', 'audio', 'camera', 'gps'].filter((id) => present.has(id));
}

/** Privacy classes in chip order. */
export const PRIVACY_CHIP_ORDER: readonly PrivacyClass[] = [
  'location',
  'identity',
  'device',
  'history',
];

export function countByPrivacy(entries: readonly MetadataEntry[]): Record<PrivacyClass, number> {
  const out: Record<PrivacyClass, number> = { location: 0, identity: 0, device: 0, history: 0 };
  for (const e of entries) {
    const p = privacyOf(e);
    if (p) out[p]++;
  }
  return out;
}
