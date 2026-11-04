import { readFileSync } from 'fs';
import { join } from 'path';
import { PLURAL_DATA_LANGUAGES } from './pluralRules';
import { createI18n } from './index';
import { locales } from './locales';

describe('plural rules', () => {
  it('loads plural data for the language of every app locale', () => {
    for (const { code } of locales) {
      expect(PLURAL_DATA_LANGUAGES).toContain(code.split('-')[0]);
    }
    const src = readFileSync(join(__dirname, 'pluralRules.ts'), 'utf8');
    for (const lang of PLURAL_DATA_LANGUAGES) {
      expect(src).toContain(`@formatjs/intl-pluralrules/locale-data/${lang}.js'`);
    }
  });

  it('picks the Arabic few/many forms', () => {
    const i = createI18n('ar-SA', undefined, { react: false });
    expect(i.t('interface:photo.presets.layerCount', { count: 4 })).toBe('4 تعديلات');
    expect(i.t('interface:photo.presets.layerCount', { count: 11 })).toBe('11 تعديلًا');
  });
});
