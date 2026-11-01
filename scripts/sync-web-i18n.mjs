#!/usr/bin/env node
/**
 * Copies the web's reusable i18n shards into the app (ADR MA-0001: code and data shared with the
 * web are copied by script, never forked by hand).
 *
 *   node scripts/sync-web-i18n.mjs                  write src/i18n/generated/**
 *   node scripts/sync-web-i18n.mjs --check          exit 1 when the committed copy is stale
 *   node scripts/sync-web-i18n.mjs --web <path>     web repo location (default ../media-manipulator-ui)
 *   node scripts/sync-web-i18n.mjs --ref <git-ref>  read the web files from that ref (`git show`)
 *                                                   instead of its working tree, e.g. `--ref main`
 *   (env MM_WEB_REF=<ref> is the same as --ref)
 *   --out <dir>, --locales-dir <dir>                override src/i18n/generated and ./locales (tests)
 *
 * Copies, per locale directory: interface/{_core,components,forms,panels,tools}.json,
 * error/_core.json, accessibility/{_core,components}.json. Never pages/articles/email/metadata
 * or toolPages.ts. Writes SOURCE.json and resources.generated.ts (the loaders).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const SHARDS = [
  'interface/_core',
  'interface/components',
  'interface/forms',
  'interface/panels',
  'interface/tools',
  'error/_core',
  'accessibility/_core',
  'accessibility/components',
];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const posix = (p) => p.split(sep).join('/');

function parseArgs(argv) {
  const o = {
    check: false,
    web: null,
    ref: process.env.MM_WEB_REF || null,
    out: null,
    localesDir: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') o.check = true;
    else if (a === '--web') o.web = argv[++i];
    else if (a === '--ref') o.ref = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--locales-dir') o.localesDir = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  return o;
}

function git(web, args) {
  return execFileSync('git', ['-C', web, ...args], {
    encoding: 'buffer',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

async function loadLocales(file) {
  const mod = await import(pathToFileURL(file).href);
  return mod.locales;
}

/** Reads web files either from the working tree or from a git ref. */
function makeReader(web, ref) {
  if (!ref) return (rel) => (existsSync(join(web, rel)) ? readFileSync(join(web, rel)) : null);
  return (rel) => {
    try {
      return git(web, ['show', `${ref}:${posix(rel)}`]);
    } catch {
      return null;
    }
  };
}

function webCommit(web, ref) {
  try {
    return git(web, ['rev-parse', ref || 'HEAD'])
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

export function renderResources(codes, localesRelToGenerated) {
  const lines = [
    '// DO NOT EDIT. Written by `node scripts/sync-web-i18n.mjs` (npm run i18n:sync).',
    '/* eslint-disable */',
    '',
    'export type Resources = Record<string, Record<string, unknown>>;',
    '',
    'const merge = (...parts: Record<string, unknown>[]): Record<string, unknown> =>',
    '  Object.assign({}, ...parts);',
    '',
    'export const loaders: Record<string, () => Resources> = {',
  ];
  for (const code of codes) {
    const d = code.toLowerCase();
    const req = (s) => `require('./${d}/${s}.json')`;
    lines.push(`  '${code}': () => ({`);
    lines.push(
      `    interface: merge(${['_core', 'components', 'forms', 'panels', 'tools'].map((s) => req(`interface/${s}`)).join(', ')}),`,
    );
    lines.push(`    error: ${req('error/_core')},`);
    lines.push(
      `    accessibility: merge(${req('accessibility/_core')}, ${req('accessibility/components')}),`,
    );
    lines.push(`    app: require('${localesRelToGenerated}/${d}/app.json'),`);
    lines.push('  }),');
  }
  lines.push('};', '');
  return lines.join('\n');
}

export async function run(argv, { log = console.log, warn = console.warn } = {}) {
  const o = parseArgs(argv);
  const web = resolve(o.web ?? join(ROOT, '..', 'media-manipulator-ui'));
  const out = resolve(o.out ?? join(ROOT, 'src/i18n/generated'));
  const localesDir = resolve(o.localesDir ?? join(ROOT, 'locales'));

  if (!existsSync(web)) {
    if (o.check) {
      warn(`warning: web repo not found at ${web}; skipping i18n sync check`);
      return 0;
    }
    warn(`error: web repo not found at ${web} (use --web <path>)`);
    return 1;
  }

  const read = makeReader(web, o.ref);
  const webLocalesBuf = read('i18n/locales.ts');
  if (!webLocalesBuf) {
    warn(`error: ${web}/i18n/locales.ts not found`);
    return 1;
  }
  const tmp = mkdtempSync(join(tmpdir(), 'mm-sync-'));
  let webLocales;
  try {
    const f = join(tmp, 'web-locales.ts');
    writeFileSync(f, webLocalesBuf);
    webLocales = await loadLocales(f);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const appLocales = await loadLocales(join(ROOT, 'src/i18n/locales.ts'));

  const problems = [];
  const key = (l) => `${l.code}|${l.dir}|${l.reviewed}`;
  const webKeys = new Set(webLocales.map(key));
  const appKeys = new Set(appLocales.map(key));
  for (const k of webKeys) if (!appKeys.has(k)) problems.push(`registry row differs (web): ${k}`);
  for (const k of appKeys) if (!webKeys.has(k)) problems.push(`registry row differs (app): ${k}`);

  const files = {};
  const contents = new Map();
  for (const l of appLocales) {
    const d = l.code.toLowerCase();
    for (const shard of SHARDS) {
      const buf = read(`i18n/locales/${d}/${shard}.json`);
      if (!buf) {
        problems.push(`missing in web: i18n/locales/${d}/${shard}.json`);
        continue;
      }
      files[`${d}/${shard}.json`] = sha256(buf);
      contents.set(`${d}/${shard}.json`, buf);
    }
  }

  const resourcesSrc = renderResources(
    appLocales.map((l) => l.code),
    posix(relative(out, localesDir)),
  );

  if (o.check) {
    const stale = [...problems];
    for (const [rel, buf] of contents) {
      const p = join(out, rel);
      if (!existsSync(p) || sha256(readFileSync(p)) !== sha256(buf))
        stale.push(`stale: ${posix(rel)}`);
    }
    const resP = join(out, 'resources.generated.ts');
    if (!existsSync(resP) || readFileSync(resP, 'utf8') !== resourcesSrc)
      stale.push('stale: resources.generated.ts');
    const srcP = join(out, 'SOURCE.json');
    if (!existsSync(srcP)) stale.push('missing: SOURCE.json');
    else {
      const recorded = JSON.parse(readFileSync(srcP, 'utf8')).files ?? {};
      for (const k of Object.keys(files))
        if (recorded[k] !== files[k]) stale.push(`SOURCE.json hash differs: ${k}`);
      for (const k of Object.keys(recorded))
        if (!(k in files)) stale.push(`SOURCE.json extra: ${k}`);
    }
    if (stale.length) {
      warn(`i18n sync check FAILED (${stale.length}):`);
      for (const s of stale) warn(`  ${s}`);
      warn('Run `npm run i18n:sync` (and commit the result).');
      return 1;
    }
    log(`i18n sync check OK (${contents.size} files)`);
    return 0;
  }

  if (problems.length) {
    for (const p of problems) warn(`error: ${p}`);
    return 1;
  }
  for (const [rel, buf] of contents) {
    const p = join(out, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, buf);
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'resources.generated.ts'), resourcesSrc);
  const source = {
    webRepo: 'media-manipulator-ui',
    webCommit: webCommit(web, o.ref),
    syncedAt: new Date().toISOString(),
    files,
  };
  writeFileSync(join(out, 'SOURCE.json'), `${JSON.stringify(source, null, 2)}\n`);
  log(`synced ${contents.size} files from ${source.webCommit.slice(0, 8)}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
