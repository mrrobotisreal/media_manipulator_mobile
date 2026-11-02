// Ported from media-manipulator-ui lib/metadata/keys.ts @ f67c959 (web main). Keep in step with the web file.
/**
 * i18n key sanitizer for catalog descriptions.
 *
 * i18next treats `.` as the key separator and `:` as the namespace separator,
 * so a tag such as `com.apple.quicktime.make` cannot be a JSON key segment as
 * is. `sanitizeKeySegment` maps both (and whitespace runs) to `_`.
 *
 * Description keys are `about.<Group|_>.<Tag>__<category>`: group-less catalog
 * rows use the group segment `_`, and the category suffix is always present
 * because one tag name (e.g. `DateTimeOriginal`) has a different description per
 * category, even within one group (`XMP-exif`). Deviation from the ticket's
 * `about.<Group>.<Tag>`, recorded in the MM09 log.
 */
export function sanitizeKeySegment(segment: string): string {
  return segment.replace(/[.:\s]+/g, '_');
}

export interface AboutKeySource {
  group?: string;
  tag: string;
  category: string;
}

/** Key (relative to the `metadata` root, no namespace) of a catalog row's description. */
export function aboutKey(row: AboutKeySource): string {
  const group = row.group ? sanitizeKeySegment(row.group) : '_';
  return `about.${group}.${sanitizeKeySegment(row.tag)}__${row.category}`;
}
