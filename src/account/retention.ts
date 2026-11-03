import type { RetentionSettingBucket } from '@/analytics/events';
import type { RetentionPreview } from '@/api/schemas/accountSettings';

/** Port of `media-manipulator-ui/lib/account/retention.ts` (presets, custom days, preview total). */
export const FALLBACK_LIMITS = { minHours: 24, maxHours: 17520, defaultHours: 4320 } as const;

export const RETENTION_PRESETS = [
  { id: 'h24', hours: 24 },
  { id: 'd7', hours: 168 },
  { id: 'd30', hours: 720 },
  { id: 'd90', hours: 2160 },
  { id: 'm6', hours: 4320 },
  { id: 'y1', hours: 8760 },
  { id: 'y2', hours: 17520 },
] as const;

export type PresetId = (typeof RETENTION_PRESETS)[number]['id'];
export const RECOMMENDED_PRESET: PresetId = 'm6';

export function presetForHours(hours: number): PresetId | null {
  return RETENTION_PRESETS.find((p) => p.hours === hours)?.id ?? null;
}

export const CUSTOM_MIN_DAYS = 1;
export const CUSTOM_MAX_DAYS = 730;

export type CustomParse = { ok: true; days: number; hours: number } | { ok: false };

/** "Custom" is whole days, 1 to 730, converted to hours and clamped into the server's limits. */
export function parseCustomDays(
  raw: string,
  limits: { minHours: number; maxHours: number } = FALLBACK_LIMITS,
): CustomParse {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return { ok: false };
  const days = Number(text);
  if (days < CUSTOM_MIN_DAYS || days > CUSTOM_MAX_DAYS) return { ok: false };
  return { ok: true, days, hours: Math.min(limits.maxHours, Math.max(limits.minHours, days * 24)) };
}

/** Everything a shrink would delete now, as one count (the confirm sheet is skipped at zero). */
export function previewTotal(preview: RetentionPreview): number {
  const w = preview.wouldDelete;
  return w.results + w.projects + w.other;
}

/** A smaller window can delete files immediately, so it is previewed first; a longer one saves directly. */
export function isShrink(currentHours: number, nextHours: number): boolean {
  return nextHours < currentHours;
}

/** Port of `lib/analytics/buckets.ts` `retentionBucket`. */
export function retentionBucket(hours: number): RetentionSettingBucket {
  switch (hours) {
    case 24:
      return '24h';
    case 168:
      return '7d';
    case 720:
      return '30d';
    case 2160:
      return '90d';
    case 4320:
      return '6mo';
    case 8760:
      return '1y';
    case 17520:
      return '2y';
    default:
      return 'custom';
  }
}
