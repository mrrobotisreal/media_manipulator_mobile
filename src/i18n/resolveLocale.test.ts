import { resolveLocale } from './resolveLocale';

const dev = (...tags: string[]) => tags.map((languageTag) => ({ languageTag }));

describe('resolveLocale', () => {
  it.each([
    ['pt-BR', 'pt-BR'],
    ['en-US', 'en-US'],
    ['en-GB', 'en-US'],
    ['zh-Hant-HK', 'zh-TW'],
    ['zh-Hant', 'zh-TW'],
    ['zh-TW', 'zh-TW'],
    ['zh-HK', 'zh-TW'],
    ['zh-MO', 'zh-TW'],
    ['zh-Hans-CN', 'zh-CN'],
    ['zh-SG', 'zh-CN'],
    ['zh', 'zh-CN'],
    ['es-419', 'es-MX'],
    ['es-AR', 'es-MX'],
    ['es-US', 'es-MX'],
    ['es-ES', 'es-ES'],
    ['es', 'es-ES'],
    ['pt-PT', 'pt-PT'],
    ['pt-AO', 'pt-BR'],
    ['pt', 'pt-BR'],
    ['iw-IL', 'he-IL'],
    ['iw', 'he-IL'],
    ['ar-EG', 'ar-SA'],
    ['de-AT', 'de-DE'],
    ['fr-CA', 'fr-FR'],
    ['uk', 'uk-UA'],
    ['ja', 'ja-JP'],
    ['vi-VN', 'vi-VN'],
    ['sw-KE', 'en-US'],
    ['xx', 'en-US'],
  ])('device %s -> %s', (tag, expected) => {
    expect(resolveLocale(null, dev(tag))).toBe(expected);
  });

  it('accepts underscore tags', () => {
    expect(resolveLocale(null, dev('pt_PT'))).toBe('pt-PT');
  });

  it('falls through to the next device locale', () => {
    expect(resolveLocale(null, dev('sw-KE', 'de-CH'))).toBe('de-DE');
  });

  it('defaults to en-US with no device locales', () => {
    expect(resolveLocale(null, [])).toBe('en-US');
    expect(resolveLocale(undefined)).toBe('en-US');
  });

  it('the override wins over the device locale', () => {
    expect(resolveLocale('ru-RU', dev('de-DE'))).toBe('ru-RU');
    expect(resolveLocale('he-IL', dev('en-US'))).toBe('he-IL');
  });

  it('normalises a lowercase or loose override', () => {
    expect(resolveLocale('pt-pt', dev('de-DE'))).toBe('pt-PT');
    expect(resolveLocale('ru', dev('de-DE'))).toBe('ru-RU');
  });

  it('ignores an unsupported override', () => {
    expect(resolveLocale('xx-YY', dev('de-DE'))).toBe('de-DE');
  });
});
