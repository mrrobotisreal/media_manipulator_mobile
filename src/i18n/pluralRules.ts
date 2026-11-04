/**
 * Hermes ships Intl without `PluralRules`, so i18next falls back to a one/other rule: Arabic "4
 * تعديل" instead of "4 تعديلات", Russian/Ukrainian "5 файла" instead of "5 файлов". This installs
 * the formatjs polyfill (only when missing) and the CLDR plural data of every app language.
 * Imported first by `./index`, before any i18next instance is created. Keep the data list in step
 * with `locales.ts` (a test enforces it).
 */
import '@formatjs/intl-pluralrules/polyfill.js';
import '@formatjs/intl-pluralrules/locale-data/en.js';
import '@formatjs/intl-pluralrules/locale-data/uk.js';
import '@formatjs/intl-pluralrules/locale-data/ru.js';
import '@formatjs/intl-pluralrules/locale-data/he.js';
import '@formatjs/intl-pluralrules/locale-data/de.js';
import '@formatjs/intl-pluralrules/locale-data/es.js';
import '@formatjs/intl-pluralrules/locale-data/fr.js';
import '@formatjs/intl-pluralrules/locale-data/it.js';
import '@formatjs/intl-pluralrules/locale-data/ja.js';
import '@formatjs/intl-pluralrules/locale-data/zh.js';
import '@formatjs/intl-pluralrules/locale-data/ko.js';
import '@formatjs/intl-pluralrules/locale-data/ar.js';
import '@formatjs/intl-pluralrules/locale-data/hi.js';
import '@formatjs/intl-pluralrules/locale-data/pt.js';
import '@formatjs/intl-pluralrules/locale-data/vi.js';

/** The language subtags whose plural data is loaded above. */
export const PLURAL_DATA_LANGUAGES = [
  'en',
  'uk',
  'ru',
  'he',
  'de',
  'es',
  'fr',
  'it',
  'ja',
  'zh',
  'ko',
  'ar',
  'hi',
  'pt',
  'vi',
] as const;
