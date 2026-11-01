import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../../scripts/check-i18n.mjs');
const REAL = resolve(__dirname, '../..');

let root: string;

const read = (code: string) =>
  JSON.parse(readFileSync(join(root, 'locales', code, 'app.json'), 'utf8'));
const write = (code: string, v: unknown) =>
  writeFileSync(join(root, 'locales', code, 'app.json'), JSON.stringify(v, null, 2));
const run = () => {
  const r = spawnSync('node', [SCRIPT, '--root', root], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'check-i18n-'));
  mkdirSync(join(root, 'src/i18n'), { recursive: true });
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'app'), { recursive: true });
  cpSync(join(REAL, 'locales'), join(root, 'locales'), { recursive: true });
  cpSync(join(REAL, 'src/i18n/locales.ts'), join(root, 'src/i18n/locales.ts'));
  cpSync(join(REAL, 'scripts/i18n-allowlist.json'), join(root, 'scripts/i18n-allowlist.json'));
  const gen = 'src/i18n/generated/en-us';
  mkdirSync(join(root, gen, 'interface'), { recursive: true });
  writeFileSync(join(root, gen, 'interface/_core.json'), '{"x":{"y":"Y"}}');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('check-i18n', () => {
  it('passes on the real locale files', () => {
    expect(run().code).toBe(0);
  });

  it('fails on a missing key', () => {
    const j = read('de-de');
    delete j.tabs.tools;
    write('de-de', j);
    const r = run();
    expect(r.code).toBe(1);
    expect(r.out).toContain('de-DE: tabs.tools: missing key');
  });

  it('fails on an extra key', () => {
    const j = read('fr-fr');
    j.tabs.extra = 'plus';
    write('fr-fr', j);
    expect(run().out).toContain('fr-FR: tabs.extra: extra key');
  });

  it('fails on a placeholder mismatch', () => {
    const en = read('en-us');
    en.common.hello = 'Hi {{name}}';
    write('en-us', en);
    for (const c of [
      'uk-ua',
      'ru-ru',
      'he-il',
      'de-de',
      'es-es',
      'es-mx',
      'fr-fr',
      'it-it',
      'ja-jp',
      'zh-cn',
      'zh-tw',
      'ko-kr',
      'ar-sa',
      'hi-in',
      'pt-pt',
      'pt-br',
      'vi-vn',
    ]) {
      const j = read(c);
      j.common.hello = c === 'de-de' ? 'Hallo {{nome}}' : `salut ${c} {{name}}`;
      write(c, j);
    }
    const r = run();
    expect(r.out).toContain('de-DE: common.hello: placeholder mismatch');
    expect(r.out).not.toContain('fr-FR: common.hello');
  });

  it('requires locale plural categories (ru-RU few/many, ar-SA all six)', () => {
    const en = read('en-us');
    en.common.files_one = '{{count}} file';
    en.common.files_other = '{{count}} files';
    write('en-us', en);
    const ru = read('ru-ru');
    ru.common.files_one = '{{count}} файл';
    ru.common.files_other = '{{count}} файла';
    write('ru-ru', ru);
    const r = run();
    expect(r.out).toContain('ru-RU: common.files_few: missing key');
    expect(r.out).toContain('ru-RU: common.files_many: missing key');
    expect(r.out).toContain('ar-SA: common.files_zero: missing key');
    expect(r.out).not.toContain('ru-RU: common.files_one');
    expect(r.out).not.toContain('ja-JP: common.files_one');
  });

  it('fails on an empty string', () => {
    const j = read('ko-kr');
    j.common.done = '  ';
    write('ko-kr', j);
    expect(run().out).toContain('ko-KR: common.done: empty');
  });

  it('fails on an English-identical leaf, allowlisted values and keys pass', () => {
    const j = read('de-de');
    j.common.cancel = 'Cancel';
    j.common.ok = 'OK';
    write('de-de', j);
    const r = run();
    expect(r.out).toContain('de-DE: common.cancel: English-identical');
    expect(r.out).not.toContain('de-DE: common.ok');
    const allow = JSON.parse(readFileSync(join(root, 'scripts/i18n-allowlist.json'), 'utf8'));
    allow.keys.push('de-DE:common.cancel');
    writeFileSync(join(root, 'scripts/i18n-allowlist.json'), JSON.stringify(allow));
    expect(run().code).toBe(0);
  });

  it('fails on an unknown literal t() key and honours i18n-keys declarations', () => {
    writeFileSync(
      join(root, 'app/a.tsx'),
      "t('tabs.tools'); t('tabs.nope'); t('interface:x.y'); t('interface:x.z');",
    );
    const r = run();
    expect(r.out).toContain('key "tabs.nope" not in en-US app');
    expect(r.out).toContain('key "interface:x.z" not in en-US interface');
    expect(r.out).not.toContain('"tabs.tools"');
    writeFileSync(join(root, 'app/a.tsx'), '// i18n-keys: tabs.tools, tabs.ghost\n');
    expect(run().out).toContain('"tabs.ghost"');
  });
});
