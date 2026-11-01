import { defaultLocale, locales } from './locales';

export interface DeviceLocale {
  languageTag?: string | null;
  languageCode?: string | null;
}

const CODES = new Map(locales.map((l) => [l.code.toLowerCase(), l.code]));

const LATAM_ES = new Set([
  'MX', '419', 'AR', 'BO', 'CL', 'CO', 'CR', 'CU', 'DO', 'EC', 'GT', 'HN', 'NI', 'PA', 'PE',
  'PR', 'PY', 'SV', 'US', 'UY', 'VE',
]); // prettier-ignore

/** Maps one BCP-47 tag to a supported app locale, or null. */
export function matchTag(rawTag: string): string | null {
  const parts = rawTag.replace(/_/g, '-').split('-').filter(Boolean);
  if (parts.length === 0) return null;
  let lang = parts[0]!.toLowerCase();
  if (lang === 'iw') lang = 'he';
  if (lang === 'in') lang = 'id';
  const rest = parts.slice(1);
  const script = rest.find((p) => p.length === 4)?.toLowerCase();
  const region = rest.find((p) => p.length === 2 || /^\d{3}$/.test(p))?.toUpperCase();

  const exact = CODES.get(region ? `${lang}-${region.toLowerCase()}` : lang);
  if (exact) return exact;

  if (lang === 'zh') {
    if (script === 'hant' || region === 'TW' || region === 'HK' || region === 'MO') return 'zh-TW';
    return 'zh-CN'; // hans, CN, SG and bare `zh`
  }
  if (lang === 'es') return region && LATAM_ES.has(region) ? 'es-MX' : 'es-ES';
  if (lang === 'pt') return region === 'PT' ? 'pt-PT' : 'pt-BR';
  return locales.find((l) => l.code.split('-')[0]!.toLowerCase() === lang)?.code ?? null;
}

/**
 * `override` (settings.locale) wins when it is a supported code, else the first device locale
 * that matches, else en-US.
 */
export function resolveLocale(
  override: string | null | undefined,
  deviceLocales: readonly DeviceLocale[] = [],
): string {
  if (override) {
    const exact = CODES.get(override.toLowerCase());
    if (exact) return exact;
    const m = matchTag(override);
    if (m) return m;
  }
  for (const d of deviceLocales) {
    const tag = d.languageTag ?? d.languageCode;
    const m = tag ? matchTag(tag) : null;
    if (m) return m;
  }
  return defaultLocale;
}
