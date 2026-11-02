/** ISO-639-1 codes of the 18 app locales (deduplicated), offered as spoken-language hints for Whisper. */
export const TRANSCRIBE_LANGUAGES: readonly string[] = [
  'en',
  'uk',
  'ru',
  'de',
  'he',
  'ar',
  'es',
  'fr',
  'it',
  'ja',
  'zh',
  'ko',
  'hi',
  'pt',
  'vi',
];

/** Native-script-free display name via Intl (MA05 formatter precedent); falls back to the code. */
export function languageName(code: string, locale: string): string {
  try {
    const DN = (
      Intl as unknown as {
        DisplayNames?: new (
          l: string[],
          o: { type: string },
        ) => { of(c: string): string | undefined };
      }
    ).DisplayNames;
    if (DN) {
      const name = new DN([locale], { type: 'language' }).of(code);
      if (name) return name;
    }
  } catch {
    // fall through
  }
  return code.toUpperCase();
}
