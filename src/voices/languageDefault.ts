export type AudioLanguageDefaults = { appLocale: string; offered: readonly string[] };

/** The default language hint: the app locale's language if the server offers it, else English, else the first. */
export function defaultVoiceLanguage(appLocale: string, offered: readonly string[]): string {
  const base = appLocale.toLowerCase().split(/[-_]/)[0] ?? 'en';
  if (offered.includes(base)) return base;
  if (offered.includes('en')) return 'en';
  return offered[0] ?? 'en';
}
