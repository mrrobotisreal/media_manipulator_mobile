import { createI18n, changeAppLanguage, NAMESPACES } from './index';
import { loaders } from './generated/resources.generated';
import { locales } from './locales';

const fixtureLoaders = {
  'en-US': () => ({
    app: { a: 'English A', b: 'English B', n_one: '{{count}} file', n_other: '{{count}} files' },
  }),
  'de-DE': () => ({ app: { a: 'Deutsch A' } }),
};

describe('createI18n', () => {
  it('falls back to en-US for a key missing in the active locale', () => {
    const i = createI18n('de-DE', fixtureLoaders, { react: false });
    expect(i.t('a')).toBe('Deutsch A');
    expect(i.t('b')).toBe('English B');
  });

  it('pluralises with the active locale rules', () => {
    const i = createI18n('en-US', fixtureLoaders, { react: false });
    expect(i.t('n', { count: 1 })).toBe('1 file');
    expect(i.t('n', { count: 3 })).toBe('3 files');
  });

  it('switches language live and loads the bundle', async () => {
    const i = createI18n('en-US', fixtureLoaders, { react: false });
    await changeAppLanguage(i, 'de-DE', fixtureLoaders);
    expect(i.t('a')).toBe('Deutsch A');
  });
});

describe('generated resources', () => {
  it('resolves synced error/interface/accessibility keys and app keys in de-DE', () => {
    const i = createI18n('de-DE', loaders, { react: false });
    const en = createI18n('en-US', loaders, { react: false });
    expect(i.t('error:auth.tryAgain')).not.toBe('error:auth.tryAgain');
    expect(i.t('error:auth.tryAgain')).not.toBe(en.t('error:auth.tryAgain'));
    expect(i.t('interface:authModal.googleSignIn')).not.toBe('interface:authModal.googleSignIn');
    expect(i.t('accessibility:skipToContent')).not.toBe('accessibility:skipToContent');
    expect(i.t('tabs.tools')).toBe('Werkzeuge');
  });

  it('loads a loader for every registry locale with all four namespaces', () => {
    for (const l of locales) {
      const bundle = loaders[l.code]!();
      for (const ns of NAMESPACES) expect(Object.keys(bundle[ns] ?? {}).length).toBeGreaterThan(0);
    }
  });

  it('has no top-level key collisions across the merged interface shards', () => {
    const shards = ['_core', 'components', 'forms', 'panels', 'tools'];
    for (const l of locales) {
      const seen = new Map<string, string>();
      for (const s of shards) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const json = require(`./generated/${l.code.toLowerCase()}/interface/${s}.json`);
        for (const k of Object.keys(json)) {
          expect([l.code, k, seen.get(k)]).toEqual([l.code, k, undefined]);
          seen.set(k, s);
        }
      }
    }
  });
});
