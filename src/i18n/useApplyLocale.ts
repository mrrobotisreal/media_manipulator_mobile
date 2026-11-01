import { useEffect } from 'react';
import { I18nManager } from 'react-native';
import * as Localization from 'expo-localization';
import { useAppSelector } from '@/state/hooks';
import { changeAppLanguage, i18n } from './index';
import { isRtlLocale } from './locales';
import { resolveLocale } from './resolveLocale';

/** Keeps i18next on `settings.locale` (else the device locale) once settings rehydrate. */
export function useApplyLocale() {
  const override = useAppSelector((s) => s.settings.locale);
  useEffect(() => {
    I18nManager.allowRTL(true);
    const next = resolveLocale(override, Localization.getLocales());
    // Heal a direction mismatch left by a system language change; takes effect next launch.
    if (isRtlLocale(next) !== I18nManager.isRTL) I18nManager.forceRTL(isRtlLocale(next));
    if (i18n.language !== next) void changeAppLanguage(i18n, next);
  }, [override]);
}
