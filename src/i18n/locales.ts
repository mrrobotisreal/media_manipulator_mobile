/**
 * The 18 app locales. COPIED from `media-manipulator-ui/i18n/locales.ts` (code, prefix, label,
 * englishLabel, dir, reviewed; `flag` and `translated` are web-only). `scripts/sync-web-i18n.mjs
 * --check` fails when the codes, `dir` or `reviewed` differ from the web registry.
 * Keep this file erasable TypeScript (no enums): the sync script imports it on bare Node.
 */
export interface LocaleDef {
  /** BCP-47 code used as the i18next language key (`en-US`). */
  code: string;
  /** Web URL prefix; unused by the app, kept for registry parity. */
  prefix: string;
  /** Native language label shown in the language picker. */
  label: string;
  /** English name, shown as the secondary label. */
  englishLabel: string;
  dir: 'ltr' | 'rtl';
  /** True once a human reviewed the web UI strings (does not cover new app strings). */
  reviewed: boolean;
}

export const locales: LocaleDef[] = [
  {
    code: 'en-US',
    prefix: 'en',
    label: 'English',
    englishLabel: 'English',
    dir: 'ltr',
    reviewed: true,
  },
  {
    code: 'uk-UA',
    prefix: 'uk',
    label: 'Українська',
    englishLabel: 'Ukrainian',
    dir: 'ltr',
    reviewed: true,
  },
  {
    code: 'ru-RU',
    prefix: 'ru',
    label: 'Русский',
    englishLabel: 'Russian',
    dir: 'ltr',
    reviewed: true,
  },
  {
    code: 'he-IL',
    prefix: 'he',
    label: 'עברית',
    englishLabel: 'Hebrew',
    dir: 'rtl',
    reviewed: false,
  },
  {
    code: 'de-DE',
    prefix: 'de',
    label: 'Deutsch',
    englishLabel: 'German',
    dir: 'ltr',
    reviewed: true,
  },
  {
    code: 'es-ES',
    prefix: 'es',
    label: 'Español (España)',
    englishLabel: 'Spanish (Spain)',
    dir: 'ltr',
    reviewed: false,
  },
  {
    code: 'es-MX',
    prefix: 'es-mx',
    label: 'Español (Latinoamérica)',
    englishLabel: 'Spanish (Latin America)',
    dir: 'ltr',
    reviewed: false,
  },
  {
    code: 'fr-FR',
    prefix: 'fr',
    label: 'Français',
    englishLabel: 'French',
    dir: 'ltr',
    reviewed: false,
  },
  {
    code: 'it-IT',
    prefix: 'it',
    label: 'Italiano',
    englishLabel: 'Italian',
    dir: 'ltr',
    reviewed: false,
  },
  {
    code: 'ja-JP',
    prefix: 'ja',
    label: '日本語',
    englishLabel: 'Japanese',
    dir: 'ltr',
    reviewed: false,
  },
  {
    code: 'zh-CN',
    prefix: 'zh-cn',
    label: '简体中文',
    englishLabel: 'Chinese (Simplified)',
    dir: 'ltr',
    reviewed: false,
  },
  {
    code: 'zh-TW',
    prefix: 'zh-tw',
    label: '繁體中文',
    englishLabel: 'Chinese (Traditional)',
    dir: 'ltr',
    reviewed: false,
  },
  {
    code: 'ko-KR',
    prefix: 'ko',
    label: '한국어',
    englishLabel: 'Korean',
    dir: 'ltr',
    reviewed: false,
  },
  {
    code: 'ar-SA',
    prefix: 'ar',
    label: 'العربية',
    englishLabel: 'Arabic',
    dir: 'rtl',
    reviewed: false,
  },
  {
    code: 'hi-IN',
    prefix: 'hi',
    label: 'हिन्दी',
    englishLabel: 'Hindi',
    dir: 'ltr',
    reviewed: false,
  },
  {
    code: 'pt-PT',
    prefix: 'pt-pt',
    label: 'Português (Portugal)',
    englishLabel: 'Portuguese (Portugal)',
    dir: 'ltr',
    reviewed: false,
  },
  {
    code: 'pt-BR',
    prefix: 'pt-br',
    label: 'Português (Brasil)',
    englishLabel: 'Portuguese (Brazil)',
    dir: 'ltr',
    reviewed: false,
  },
  {
    code: 'vi-VN',
    prefix: 'vi',
    label: 'Tiếng Việt',
    englishLabel: 'Vietnamese',
    dir: 'ltr',
    reviewed: false,
  },
];

export const defaultLocale = 'en-US';

export type LocaleCode = (typeof locales)[number]['code'];

/** Directory name used by web and app shards: `en-US` -> `en-us`. */
export const localeDir = (code: string): string => code.toLowerCase();

export function findLocale(code: string): LocaleDef | undefined {
  return locales.find((l) => l.code === code);
}

export function isRtlLocale(code: string): boolean {
  return findLocale(code)?.dir === 'rtl';
}
