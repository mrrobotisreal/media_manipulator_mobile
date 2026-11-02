import { track } from '@/analytics/track';
import type { MetadataDocument, PrivacyClass } from './types';

/**
 * Metadata analytics (MA21). Port of web `lib/metadata/useMetadataAnalytics.ts` + `lib/analytics/buckets.ts`
 * `metadataTagBucket`, as plain functions. Props follow `internal/catalog/catalog.go`: enums and
 * buckets only, never tag names, values, file names or coordinates.
 */
export type MetadataSurface = 'home' | 'tool_page' | 'result' | 'history';
export type TagBucket = '0' | '1-25' | '26-100' | '101-500' | '500+';

export function metadataTagBucket(n: number): TagBucket {
  if (!(n > 0)) return '0';
  if (n <= 25) return '1-25';
  if (n <= 100) return '26-100';
  if (n <= 500) return '101-500';
  return '500+';
}

const KINDS: ReadonlySet<string> = new Set(['image', 'video', 'audio', 'pdf', 'document']);

/** Enum-ify the document kind so an unexpected server string never becomes a free-form property. */
export const metadataKindOf = (doc: MetadataDocument): string =>
  KINDS.has(doc.file.kind) ? doc.file.kind : 'other';

/** Documents already reported, per surface: `metadata_inspected` is once per document. */
const reported = new WeakMap<MetadataDocument, Set<string>>();

export function trackMetadataInspected(doc: MetadataDocument, surface: MetadataSurface): void {
  let seen = reported.get(doc);
  if (!seen) {
    seen = new Set();
    reported.set(doc, seen);
  }
  if (seen.has(surface)) return;
  seen.add(surface);
  track('metadata_inspected', {
    surface,
    kind: metadataKindOf(doc),
    tag_bucket: metadataTagBucket(doc.entries.length),
    has_gps: doc.entries.some((e) => e.category === 'gps'),
    has_c2pa: doc.entries.some((e) => e.category === 'c2pa'),
  });
}

export const trackSectionToggled = (category: string, open: boolean): void =>
  track('metadata_section_toggled', { category, open });

/** The catalog event carries no query text and no counts. */
export const trackSearchUsed = (): void => track('metadata_search_used', {});

export const trackPrivacyFilter = (flag: PrivacyClass): void =>
  track('metadata_privacy_filter_used', { flag });

export function trackDiffOpened(
  tool: string,
  counts: { removed: number; added: number; changed: number },
): void {
  track('metadata_diff_opened', {
    tool,
    removed_bucket: metadataTagBucket(counts.removed),
    added_bucket: metadataTagBucket(counts.added),
    changed_bucket: metadataTagBucket(counts.changed),
  });
}
