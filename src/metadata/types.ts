// Ported from media-manipulator-ui lib/metadata/types.ts @ f67c959 (web main). Keep in step with the web file.
import { z } from 'zod';

/**
 * Canonical metadata document, mirroring the API's `internal/metadata/types.go`
 * (docs/design/METADATA_INSPECTOR.md section 3.1, ticket MM07). The Zod schema
 * is what the `useMetadataInspect` / `useJobMetadata` hooks (MM10/MM11) parse
 * responses with. No React and no `components/` imports in this directory.
 */

export const PRIVACY_CLASSES = ['location', 'identity', 'device', 'history'] as const;
export type PrivacyClass = (typeof PRIVACY_CLASSES)[number];

/** Category ids in display order (design section 3.3). */
export const CATEGORY_ORDER = [
  'file',
  'image',
  'camera',
  'lens',
  'gps',
  'datetime',
  'color',
  'thumbnail',
  'iptc',
  'xmp',
  'history',
  'video',
  'audio',
  'container',
  'apple',
  'png',
  'pdf',
  'c2pa',
  'pano',
  'makernote',
  'composite',
  'other',
] as const;
export type CategoryId = (typeof CATEGORY_ORDER)[number];

/** A JSON value as exiftool / ffprobe produce it (scalars, arrays, nested objects). */
export type MetadataValue =
  string | number | boolean | null | MetadataValue[] | { [key: string]: MetadataValue };

const metadataValueSchema: z.ZodType<MetadataValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(metadataValueSchema),
    z.record(z.string(), metadataValueSchema),
  ]),
);

export const metadataEntrySchema = z.object({
  id: z.string(),
  group: z.string(),
  tag: z.string(),
  value: metadataValueSchema,
  rawValue: metadataValueSchema.optional(),
  binary: z.boolean().optional(),
  category: z.string(),
  // The API omits the field for unclassified entries; tolerate "" and unknown classes.
  privacy: z.string().optional(),
});
export type MetadataEntry = z.infer<typeof metadataEntrySchema>;

export const fileSummarySchema = z.object({
  name: z.string(),
  sizeBytes: z.number(),
  mime: z.string(),
  kind: z.string(),
  sha256: z.string().optional(),
  modificationTime: z.string().optional(),
});
export type FileSummary = z.infer<typeof fileSummarySchema>;

export const metadataDocumentSchema = z.object({
  schemaVersion: z.number(),
  file: fileSummarySchema,
  tools: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
  entries: z
    .array(metadataEntrySchema)
    .nullish()
    .transform((v) => v ?? []),
  warnings: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
});
export type MetadataDocument = z.infer<typeof metadataDocumentSchema>;

/** Value of a binary entry (`{ bytes }`), or undefined. */
export function binaryBytes(entry: MetadataEntry): number | undefined {
  if (!entry.binary) return undefined;
  const v = entry.value;
  if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.bytes === 'number')
    return v.bytes;
  return undefined;
}

/** Narrow an entry's privacy string to a known class. */
export function privacyOf(entry: Pick<MetadataEntry, 'privacy'>): PrivacyClass | undefined {
  return (PRIVACY_CLASSES as readonly string[]).includes(entry.privacy ?? '')
    ? (entry.privacy as PrivacyClass)
    : undefined;
}

/** Events the inspector reports; surfaces map them to analytics (MM11). */
export type InspectorEvent =
  | { type: 'section_toggled'; category: string; open: boolean }
  | { type: 'search_used'; length: number; results: number }
  | { type: 'privacy_filter_used'; privacy: PrivacyClass; active: boolean }
  | { type: 'binary_downloaded'; entryId: string };

export type InspectorSurface = 'home' | 'tool_page' | 'result';

/** Events the diff modal and the result line report; MM11 maps them to analytics. */
export type DiffEvent =
  | {
      type: 'diff_opened';
      surface: InspectorSurface;
      removed: number;
      added: number;
      changed: number;
    }
  | { type: 'mode_changed'; mode: 'unified' | 'split' };

// ---- App additions (not in the web file) ----
export type DiffSurface = 'tool_page' | 'result' | 'history';
