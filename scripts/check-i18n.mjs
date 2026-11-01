#!/usr/bin/env node
/**
 * i18n gate. For every `locales/<code>/app.json` against `locales/en-us/app.json`:
 * missing key, extra key, placeholder mismatch, missing plural category, empty string,
 * English-identical leaf (unless allowlisted). Also checks that every literal `t('…')` key in
 * `app/` and `src/` exists (app keys in en-US app.json; `interface:` / `error:` /
 * `accessibility:` keys in the synced en-US web shards). Dynamic keys are declared in a
 * `// i18n-keys: a.b, c.d` comment.
 *
 *   node scripts/check-i18n.mjs [--root <dir>]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'];
const PH = /\{\{\s*(\w+)\s*\}\}/g;

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, p, out);
    else out[p] = v;
  }
  return out;
}

const placeholders = (s) =>
  [...String(s).matchAll(PH)]
    .map((m) => m[1])
    .sort()
    .join(',');

function pluralSplit(path) {
  const m = /^(.*)_(zero|one|two|few|many|other)$/.exec(path);
  return m ? { base: m[1], cat: m[2] } : null;
}

function walk(dir, exts, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'generated' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => e.endsWith(x)) && !/\.test\.[tj]sx?$/.test(e)) out.push(p);
  }
  return out;
}

export async function check(root) {
  const failures = [];
  const fail = (locale, key, msg) => failures.push(`${locale}: ${key}: ${msg}`);
  const localesDir = join(root, 'locales');
  const allow = JSON.parse(readFileSync(join(root, 'scripts/i18n-allowlist.json'), 'utf8'));
  const allowedValues = new Set(allow.values ?? []);
  const allowedKeys = new Set(allow.keys ?? []);

  const registry = (await import(pathToFileURL(join(root, 'src/i18n/locales.ts')).href)).locales;
  const enRaw = JSON.parse(readFileSync(join(localesDir, 'en-us/app.json'), 'utf8'));
  const en = flatten(enRaw);

  for (const l of registry) {
    const dir = l.code.toLowerCase();
    const file = join(localesDir, dir, 'app.json');
    if (!existsSync(file)) {
      fail(l.code, '(file)', `locales/${dir}/app.json missing`);
      continue;
    }
    let flat;
    try {
      flat = flatten(JSON.parse(readFileSync(file, 'utf8')));
    } catch (e) {
      fail(l.code, '(file)', `invalid JSON: ${e.message}`);
      continue;
    }
    const isEn = l.code === 'en-US';
    const required = new Intl.PluralRules(l.code).resolvedOptions().pluralCategories;

    // Plural families: en-US defines them; every locale needs its own required categories.
    const enFamilies = new Map();
    for (const k of Object.keys(en)) {
      const s = pluralSplit(k);
      if (s) enFamilies.set(s.base, [...(enFamilies.get(s.base) ?? []), s.cat]);
    }
    const expectedKeys = new Set(Object.keys(en).filter((k) => !pluralSplit(k)));
    for (const base of enFamilies.keys())
      for (const c of required) expectedKeys.add(`${base}_${c}`);
    const optionalPlural = (k) => {
      const s = pluralSplit(k);
      return s && enFamilies.has(s.base) && PLURAL_SUFFIXES.includes(s.cat);
    };

    for (const k of expectedKeys) if (!(k in flat)) fail(l.code, k, 'missing key');
    for (const k of Object.keys(flat)) {
      if (!expectedKeys.has(k) && !optionalPlural(k)) fail(l.code, k, 'extra key');
    }

    for (const [k, v] of Object.entries(flat)) {
      if (typeof v !== 'string' || v.trim() === '') {
        fail(l.code, k, 'empty or non-string value');
        continue;
      }
      const s = pluralSplit(k);
      const enKey =
        k in en ? k : s && en[`${s.base}_other`] !== undefined ? `${s.base}_other` : null;
      if (enKey && placeholders(v) !== placeholders(en[enKey])) {
        fail(
          l.code,
          k,
          `placeholder mismatch (${placeholders(v)} vs en-US ${placeholders(en[enKey])})`,
        );
      }
      if (!isEn && enKey && v === en[enKey]) {
        if (!allowedValues.has(v) && !allowedKeys.has(k) && !allowedKeys.has(`${l.code}:${k}`)) {
          fail(l.code, k, `English-identical value "${v}" (translate it or allowlist it)`);
        }
      }
    }
  }

  // Static scan of literal t() keys.
  const enShards = {};
  const loadNs = (ns, files) => {
    const o = {};
    for (const f of files) {
      const p = join(root, 'src/i18n/generated/en-us', f);
      if (existsSync(p)) Object.assign(o, JSON.parse(readFileSync(p, 'utf8')));
    }
    enShards[ns] = flatten(o);
  };
  loadNs(
    'interface',
    ['_core', 'components', 'forms', 'panels', 'tools'].map((s) => `interface/${s}.json`),
  );
  loadNs('error', ['error/_core.json']);
  loadNs('accessibility', ['accessibility/_core.json', 'accessibility/components.json']);
  enShards.app = en;
  const has = (ns, key) => {
    const flat = enShards[ns];
    if (key in flat) return true;
    return (
      PLURAL_SUFFIXES.some((c) => `${key}_${c}` in flat) ||
      Object.keys(flat).some((k) => k.startsWith(`${key}.`))
    );
  };
  const files = [
    ...walk(join(root, 'app'), ['.ts', '.tsx']),
    ...walk(join(root, 'src'), ['.ts', '.tsx']),
  ];
  const CALL = /(?<![\w.])t\(\s*(['"`])([^'"`$]+)\1/g;
  const DECL = /\/\/\s*i18n-keys:\s*(.+)$/gm;
  const check1 = (file, raw) => {
    const m = /^(?:(\w+):)?(.+)$/.exec(raw);
    const ns = m[1] && enShards[m[1]] ? m[1] : 'app';
    const key = m[1] && enShards[m[1]] ? m[2] : raw;
    if (!has(ns, key))
      failures.push(`${file.replace(root + '/', '')}: key "${raw}" not in en-US ${ns}`);
  };
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(CALL)) check1(f, m[2]);
    for (const m of text.matchAll(DECL))
      for (const k of m[1].split(',')) if (k.trim()) check1(f, k.trim());
  }
  return failures;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--root');
  const root = i > 0 ? resolve(process.argv[i + 1]) : resolve(HERE, '..');
  check(root).then((failures) => {
    if (failures.length) {
      console.error(`i18n check FAILED (${failures.length}):`);
      for (const f of failures) console.error(`  ${f}`);
      process.exit(1);
    }
    console.log('i18n check OK (18 locales)');
  });
}
