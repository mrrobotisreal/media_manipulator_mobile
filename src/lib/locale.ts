import * as Localization from 'expo-localization';
import type { RootState } from '@/state/store';

/**
 * Locale for Accept-Language: the user's override, else the device's, else en-US.
 * MA05 re-points this at the i18n active locale without changing callers.
 */
export function getRequestLocale(state: Pick<RootState, 'settings'>): string {
  return state.settings.locale ?? Localization.getLocales()[0]?.languageTag ?? 'en-US';
}
