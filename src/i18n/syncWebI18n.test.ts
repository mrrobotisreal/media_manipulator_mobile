import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { locales } from './locales';

const SCRIPT = resolve(__dirname, '../../scripts/sync-web-i18n.mjs');
const REGISTRY = resolve(__dirname, 'locales.ts');
const SHARDS = [
  'interface/_core', 'interface/components', 'interface/forms', 'interface/panels',
  'interface/tools', 'error/_core', 'accessibility/_core', 'accessibility/components',
]; // prettier-ignore

let tmp: string;
let web: string;
let out: string;
let appLocales: string;

function sync(...args: string[]) {
  const r = spawnSync(
    'node',
    [SCRIPT, '--web', web, '--out', out, '--locales-dir', appLocales, ...args],
    { encoding: 'utf8', env: { ...process.env, MM_WEB_REF: '' } },
  );
  return { code: r.status, out: r.stdout + r.stderr };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'sync-test-'));
  web = join(tmp, 'web');
  out = join(tmp, 'generated');
  appLocales = join(tmp, 'app-locales');
  mkdirSync(join(web, 'i18n'), { recursive: true });
  cpSync(REGISTRY, join(web, 'i18n/locales.ts'));
  for (const l of locales) {
    const d = l.code.toLowerCase();
    for (const s of SHARDS) {
      const p = join(web, 'i18n/locales', d, `${s}.json`);
      mkdirSync(join(p, '..'), { recursive: true });
      writeFileSync(p, `{"k":"${l.code} ${s}"}\n`);
    }
    // files the app must never copy
    writeFileSync(join(web, 'i18n/locales', d, 'interface/pages.json'), '{}');
    mkdirSync(join(appLocales, d), { recursive: true });
    writeFileSync(join(appLocales, d, 'app.json'), '{}');
  }
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('sync-web-i18n', () => {
  it('copies exactly the reusable shard set byte-for-byte', () => {
    expect(sync().code).toBe(0);
    for (const l of locales) {
      const d = l.code.toLowerCase();
      for (const s of SHARDS) {
        expect(readFileSync(join(out, d, `${s}.json`), 'utf8')).toBe(`{"k":"${l.code} ${s}"}\n`);
      }
      expect(existsSync(join(out, d, 'interface/pages.json'))).toBe(false);
    }
    const source = JSON.parse(readFileSync(join(out, 'SOURCE.json'), 'utf8'));
    expect(source.webRepo).toBe('media-manipulator-ui');
    expect(Object.keys(source.files)).toHaveLength(locales.length * SHARDS.length);
    expect(readFileSync(join(out, 'resources.generated.ts'), 'utf8')).toContain("'de-DE'");
  });

  it('--check passes right after a sync', () => {
    sync();
    expect(sync('--check').code).toBe(0);
  });

  it('--check fails after one byte of a generated file changes', () => {
    sync();
    writeFileSync(join(out, 'de-de/error/_core.json'), '{"k":"de-DE error/_core"} \n');
    const r = sync('--check');
    expect(r.code).toBe(1);
    expect(r.out).toContain('de-de/error/_core.json');
  });

  it('--check fails when the web shard changes after the sync', () => {
    sync();
    writeFileSync(join(web, 'i18n/locales/ja-jp/interface/tools.json'), '{"k":"changed"}\n');
    const r = sync('--check');
    expect(r.code).toBe(1);
    expect(r.out).toContain('ja-jp/interface/tools.json');
  });

  it('--check fails when a registry row differs', () => {
    sync();
    const p = join(web, 'i18n/locales.ts');
    writeFileSync(p, readFileSync(p, 'utf8').replace("code: 'de-DE'", "code: 'de-XX'"));
    const r = sync('--check');
    expect(r.code).toBe(1);
    expect(r.out).toContain('registry row differs');
  });

  it('--check fails when dir or reviewed differ', () => {
    sync();
    const p = join(web, 'i18n/locales.ts');
    writeFileSync(
      p,
      readFileSync(p, 'utf8').replace(/(code: 'he-IL'[\s\S]*?)dir: 'rtl'/, "$1dir: 'ltr'"),
    );
    expect(sync('--check').code).toBe(1);
  });

  it('missing web repo: --check warns and exits 0, a write run fails', () => {
    rmSync(web, { recursive: true });
    const check = sync('--check');
    expect(check.code).toBe(0);
    expect(check.out).toContain('warning');
    expect(sync().code).toBe(1);
  });
});
