import { findLocale } from '@/i18n/locales';

/** Public web origin (EAS public env `EXPO_PUBLIC_WEB_BASE_URL`; default is production). */
export const DEFAULT_WEB_BASE_URL = 'https://www.media-manipulator.com';
export const WEB_BASE_URL = (process.env.EXPO_PUBLIC_WEB_BASE_URL ?? DEFAULT_WEB_BASE_URL).replace(
  /\/+$/,
  '',
);

/** Web locale prefix for an app locale code: none for en-US (`/privacy-policy`), else `uk`, `es-mx`, `zh-tw`, ... */
export function webLocalePrefix(localeCode: string): string {
  const prefix = findLocale(localeCode)?.prefix ?? 'en';
  return prefix === 'en' ? '' : `/${prefix}`;
}

/** `https://www.media-manipulator.com[/<prefix>]/<path>` for the legal and account pages. */
export function webUrl(path: string, localeCode: string, base: string = WEB_BASE_URL): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base.replace(/\/+$/, '')}${webLocalePrefix(localeCode)}${p}`;
}

export const PRIVACY_PATH = '/privacy-policy';
export const TERMS_PATH = '/terms-of-service';

/**
 * MA26 ships the public `/delete-account` page; until it is deployed the link is not rendered
 * (it would 404). MA26 flips this to true.
 */
export const DELETE_ACCOUNT_WEB_PATH = '/delete-account';
export const DELETE_ACCOUNT_WEB_PATH_LIVE = false;
