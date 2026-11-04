#!/usr/bin/env node
/**
 * Copies the web's Aperture document model, reference math, fixtures, goldens and built-in presets
 * into the app (ADR MA-0010, design PHOTO_EDITOR_MOBILE.md §1: copy, never fork).
 *
 *   node scripts/sync-photo-fixtures.mjs                  write src/photo/** (npm run photo:sync)
 *   node scripts/sync-photo-fixtures.mjs --check          exit 1 when the committed copy drifts
 *   node scripts/sync-photo-fixtures.mjs --web <path>     web repo (default ../media-manipulator-ui)
 *   node scripts/sync-photo-fixtures.mjs --ref <git-ref>  read the web files from that ref (`git show`),
 *                                                         e.g. `--ref main` (env MM_WEB_REF is the same)
 *   --out <dir>                                           override src/photo (tests)
 *
 * TypeScript files get a generated header and their `@/lib/photo/*` / `@/lib/studio/*` imports
 * rewritten to the flat `src/photo/` copies; everything else (JSON, PNG, README) is byte-copied.
 * `src/photo/SOURCE.json` records the web commit and a SHA-256 per copied file.
 */
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Single TypeScript files: web path -> app path (relative to the out dir). */
export const TS_FILES = {
  'lib/photo/photoTypes.ts': 'photoTypes.ts',
  'lib/photo/colorMath.ts': 'colorMath.ts',
  'lib/studio/colorMath.ts': 'studioColorMath.ts',
  'lib/studio/lutParser.ts': 'studioLutParser.ts',
  'lib/photo/gl/uniforms.ts': 'webUniforms.ts',
  'lib/photo/curveEdit.ts': 'curveEdit.ts',
  'lib/photo/levelsEdit.ts': 'levelsEdit.ts',
  'lib/photo/layerOps.ts': 'layerOps.ts',
  // Test-only (node:fs + pngjs): the golden renderer the parity tests share with the web.
  'lib/photo/goldens.ts': 'goldens.ts',
};

/** Directory trees copied byte for byte: web dir -> app dir. */
export const TREES = {
  'lib/photo/fixtures': 'fixtures',
  'lib/photo/presets/builtin': 'presets/builtin',
};

/** Import specifiers rewritten in the copied TypeScript. */
export const IMPORT_MAP = {
  '@/lib/photo/photoTypes': './photoTypes',
  '@/lib/photo/colorMath': './colorMath',
  '@/lib/studio/colorMath': './studioColorMath',
  '@/lib/studio/lutParser': './studioLutParser',
  '@/lib/photo/layerOps': './layerOps',
  '@/lib/photo/goldens': './goldens',
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const posix = (p) => p.split(sep).join('/');

function parseArgs(argv) {
  const o = { check: false, web: null, ref: process.env.MM_WEB_REF || null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') o.check = true;
    else if (a === '--web') o.web = argv[++i];
    else if (a === '--ref') o.ref = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  return o;
}

function git(web, args) {
  return execFileSync('git', ['-C', web, ...args], {
    encoding: 'buffer',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 256 * 1024 * 1024,
  });
}

function walk(dir, base = dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, base, out);
    else out.push(posix(relative(base, p)));
  }
  return out;
}

/** Reads web files from the working tree or a git ref; `list(dir)` returns paths relative to dir. */
function makeSource(web, ref) {
  if (!ref) {
    return {
      read: (rel) => (existsSync(join(web, rel)) ? readFileSync(join(web, rel)) : null),
      list: (dir) => (existsSync(join(web, dir)) ? walk(join(web, dir)).sort() : []),
    };
  }
  return {
    read: (rel) => {
      try {
        return git(web, ['show', `${ref}:${posix(rel)}`]);
      } catch {
        return null;
      }
    },
    list: (dir) => {
      try {
        return git(web, ['ls-tree', '-r', '--name-only', ref, '--', `${dir}/`])
          .toString()
          .split('\n')
          .filter(Boolean)
          .map((p) => p.slice(dir.length + 1))
          .sort();
      } catch {
        return [];
      }
    },
  };
}

export function transformTs(src, webPath) {
  let text = src.toString('utf8');
  for (const [from, to] of Object.entries(IMPORT_MAP)) {
    text = text.split(`'${from}'`).join(`'${to}'`);
  }
  // The web resolves @/ to its repo root; anything still pointing there is a copy we do not make.
  const leftover = /from '@\/[^']+'/.exec(text);
  if (leftover) throw new Error(`${webPath}: unmapped import ${leftover[0]}`);
  const header = [
    `// DO NOT EDIT. Copied from media-manipulator-ui ${webPath} by scripts/sync-photo-fixtures.mjs`,
    '// (npm run photo:sync). The web repo is the source of the model and the math (ADR MA-0010);',
    '// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).',
    '// @ts-nocheck',
    '',
  ].join('\n');
  return Buffer.from(header + text, 'utf8');
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

/** Every file this sync owns: app-relative path -> expected bytes. */
export function expectedFiles(source) {
  const problems = [];
  const files = new Map();
  for (const [webPath, appPath] of Object.entries(TS_FILES)) {
    const buf = source.read(webPath);
    if (!buf) {
      problems.push(`missing in web: ${webPath}`);
      continue;
    }
    files.set(appPath, transformTs(buf, webPath));
  }
  for (const [webDir, appDir] of Object.entries(TREES)) {
    const list = source.list(webDir);
    if (list.length === 0) problems.push(`missing in web: ${webDir}/`);
    for (const rel of list) {
      const buf = source.read(`${webDir}/${rel}`);
      if (!buf) problems.push(`unreadable in web: ${webDir}/${rel}`);
      else files.set(`${appDir}/${rel}`, buf);
    }
  }
  return { files, problems };
}

export async function run(argv, { log = console.log, warn = console.warn } = {}) {
  const o = parseArgs(argv);
  const web = resolve(o.web ?? join(ROOT, '..', 'media-manipulator-ui'));
  const out = resolve(o.out ?? join(ROOT, 'src/photo'));
  if (!existsSync(web)) {
    if (o.check) {
      warn(`warning: web repo not found at ${web}; skipping photo fixture sync check`);
      return 0;
    }
    warn(`error: web repo not found at ${web} (use --web <path>)`);
    return 1;
  }
  const { files, problems } = expectedFiles(makeSource(web, o.ref));
  const hashes = Object.fromEntries([...files].map(([k, v]) => [k, sha256(v)]));

  if (o.check) {
    const stale = [...problems];
    for (const [rel, buf] of files) {
      const p = join(out, rel);
      if (!existsSync(p)) stale.push(`missing: ${rel}`);
      else if (sha256(readFileSync(p)) !== sha256(buf)) stale.push(`drifted: ${rel}`);
    }
    for (const appDir of Object.values(TREES)) {
      const d = join(out, appDir);
      if (!existsSync(d)) continue;
      for (const rel of walk(d)) {
        const k = `${appDir}/${rel}`;
        if (!files.has(k)) stale.push(`extra (not in web): ${k}`);
      }
    }
    const srcP = join(out, 'SOURCE.json');
    if (!existsSync(srcP)) stale.push('missing: SOURCE.json');
    else {
      const recorded = JSON.parse(readFileSync(srcP, 'utf8')).files ?? {};
      for (const k of Object.keys(hashes))
        if (recorded[k] !== hashes[k]) stale.push(`SOURCE.json hash differs: ${k}`);
      for (const k of Object.keys(recorded))
        if (!(k in hashes)) stale.push(`SOURCE.json extra: ${k}`);
    }
    if (stale.length) {
      warn(`photo fixture sync check FAILED (${stale.length}):`);
      for (const s of stale.slice(0, 50)) warn(`  ${s}`);
      warn('Run `npm run photo:sync` (and commit the result).');
      return 1;
    }
    log(`photo fixture sync check OK (${files.size} files)`);
    return 0;
  }

  if (problems.length) {
    for (const p of problems) warn(`error: ${p}`);
    return 1;
  }
  for (const appDir of Object.values(TREES))
    rmSync(join(out, appDir), { recursive: true, force: true });
  for (const [rel, buf] of files) {
    const p = join(out, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, buf);
  }
  const source = {
    webRepo: 'media-manipulator-ui',
    webCommit: webCommit(web, o.ref),
    syncedAt: new Date().toISOString(),
    files: hashes,
  };
  writeFileSync(join(out, 'SOURCE.json'), `${JSON.stringify(source, null, 2)}\n`);
  log(`synced ${files.size} photo files from ${source.webCommit.slice(0, 8)}`);
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
