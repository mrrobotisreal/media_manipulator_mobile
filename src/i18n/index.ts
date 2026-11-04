// Must run before i18next builds any plural resolver (Hermes has no Intl.PluralRules).
import './pluralRules';
import { createInstance, type i18n as I18nInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import { loaders as generatedLoaders, type Resources } from './generated/resources.generated';
import { defaultLocale, isRtlLocale, locales } from './locales';
import { resolveLocale } from './resolveLocale';

export const NAMESPACES = ['app', 'interface', 'error', 'accessibility'] as const;

type Loaders = Record<string, () => Resources>;

function addBundle(instance: I18nInstance, loaders: Loaders, code: string) {
  const load = loaders[code];
  if (!load) return;
  const bundle = load();
  for (const ns of NAMESPACES) {
    if (bundle[ns]) instance.addResourceBundle(code, ns, bundle[ns], true, true);
  }
}

/**
 * Builds an i18next instance. English is always loaded (fallback); `locale` is loaded too.
 * Tests pass fixture `loaders`; the app uses the generated ones.
 */
export function createI18n(
  locale: string = defaultLocale,
  loaders: Loaders = generatedLoaders,
  { react = true }: { react?: boolean } = {},
): I18nInstance {
  const instance = createInstance();
  if (react) instance.use(initReactI18next);
  void instance.init({
    lng: locale,
    fallbackLng: defaultLocale,
    supportedLngs: locales.map((l) => l.code),
    load: 'currentOnly',
    ns: [...NAMESPACES],
    defaultNS: 'app',
    interpolation: { escapeValue: false },
    returnNull: false,
    react: { useSuspense: false },
    resources: {},
    initAsync: false,
  });
  addBundle(instance, loaders, defaultLocale);
  addBundle(instance, loaders, locale);
  return instance;
}

/** Switches `instance` to `code`, loading its bundle first. Same direction: applies live. */
export async function changeAppLanguage(
  instance: I18nInstance,
  code: string,
  loaders: Loaders = generatedLoaders,
): Promise<void> {
  addBundle(instance, loaders, code);
  await instance.changeLanguage(code);
}

/** The app's instance, initialised from the device locale; the settings override is applied
 * after rehydration by `useApplyLocale`. */
export const i18n = createI18n(resolveLocale(null, Localization.getLocales()));

export function getActiveLocale(): string {
  return i18n.language || defaultLocale;
}

export function isActiveLocaleRtl(): boolean {
  return isRtlLocale(getActiveLocale());
}

export { resolveLocale, locales, defaultLocale };
