/**
 * MA52 decision 6: the Aperture glossary is the web's. For every locale the app's own Aperture
 * strings (`locales/<code>/app.json`: the tool strip and the MA52 entry rows) use the same words as
 * the synced web shard (`src/i18n/generated/<code>/interface/panels.json`, `photo.*`): Mask, Layer,
 * Preset (the web's "Looks"), Heal, Curves, Levels, Exposure. Every other photo label (sliders,
 * panel titles, layer types) is read from the web shard itself, so it cannot drift.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../..');
const LOCALES = readdirSync(join(ROOT, 'locales')).filter((d) => !d.endsWith('.md'));

const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const get = (o: unknown, path: string): string =>
  path.split('.').reduce((a: any, k) => a?.[k], o) as string;

/** Glossary term -> [app.json key, web panels.json key]. */
const GLOSSARY: Record<string, [string, string][]> = {
  Mask: [['photo.strip.masks', 'photo.panels.masks']],
  Layer: [['photo.strip.layers', 'photo.panels.layers']],
  Preset: [['photo.strip.presets', 'photo.presets.title']],
  Heal: [['photo.strip.heal', 'photo.panels.heal']],
  Curves: [
    ['photo.strip.curves', 'photo.panels.curves'],
    ['tools.aperture.curves.title', 'photo.panels.curves'],
  ],
  Levels: [
    ['photo.strip.levels', 'photo.panels.levels'],
    ['tools.aperture.levels.title', 'photo.panels.levels'],
  ],
};

describe('Aperture glossary: app strings = web shard (MA52 decision 6)', () => {
  it('covers 18 locales', () => expect(LOCALES).toHaveLength(18));

  it.each(LOCALES)('%s', (loc) => {
    const app = read(`locales/${loc}/app.json`);
    const web = read(`src/i18n/generated/${loc}/interface/panels.json`);
    const mismatches: string[] = [];
    for (const [term, pairs] of Object.entries(GLOSSARY)) {
      for (const [a, w] of pairs) {
        const av = get(app, a);
        const wv = get(web, w);
        expect(typeof wv).toBe('string');
        if (av !== wv) mismatches.push(`${term}: app ${a}="${av}" web ${w}="${wv}"`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it.each(LOCALES)('%s: Exposure and Heal inside sentences use the web words', (loc) => {
    const app = read(`locales/${loc}/app.json`);
    const web = read(`src/i18n/generated/${loc}/interface/panels.json`);
    // The web names these everywhere; the app reads its Exposure slider/layer labels from the web
    // shard (`interface:photo.params.*`, `layers.type.*`), so only the shard has to carry them.
    expect(get(web, 'photo.layers.type.exposure')).toBeTruthy();
    // The heal button the app's heal hint refers to is the web's `photo.heal.press`.
    expect(get(app, 'photo.heal.hint')).toContain(get(web, 'photo.heal.press'));
    // The entry rows name the looks they apply with the web's look names.
    expect(get(app, 'tools.aperture.black-white.description')).toContain(
      get(web, 'photo.presets.name.bw-film'),
    );
    expect(get(app, 'tools.aperture.color-pop.description')).toContain(
      get(web, 'photo.presets.name.color-pop-red'),
    );
  });
});
