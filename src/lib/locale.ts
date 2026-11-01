import * as Localization from 'expo-localization';
import { resolveLocale } from '@/i18n/resolveLocale';
import type { RootState } from '@/state/store';

/**
 * The locale for Accept-Language and the account sync: the same code the UI resolves
 * (override, else best match of the device locales, else en-US).
 */
export function getRequestLocale(state: Pick<RootState, 'settings'>): string {
  return resolveLocale(state.settings.locale, Localization.getLocales());
}
