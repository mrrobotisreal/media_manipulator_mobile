/**
 * Neutral copy for Aperture refusals that have no MA16 limit sheet (MA-0008: facts only, no price,
 * no purchase link). Returns the app i18n key and its values, or null when the generic copy fits.
 */
import type { MmError } from '@/api/errors';

export function refusalCopy(
  e: MmError | undefined,
): { key: string; values: Record<string, unknown> } | null {
  if (!e) return null;
  const d = e.details;
  switch (e.code) {
    case 'photo_projects_limit':
      return {
        key: 'photo.refused.projects',
        values: { limit: typeof d.limit === 'number' ? d.limit : 5 },
      };
    case 'photo_too_many_pixels':
      return {
        key: 'photo.refused.pixels',
        values: { mp: typeof d.maxMegapixels === 'number' ? d.maxMegapixels : 120 },
      };
    case 'photo_unsupported_source':
      return { key: 'photo.refused.unsupported', values: {} };
    default:
      return null;
  }
}
// i18n-keys: photo.refused.projects, photo.refused.pixels, photo.refused.unsupported
