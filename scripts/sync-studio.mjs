#!/usr/bin/env node
/**
 * Copies the web's Darkroom (code name `studio`) document model and DOM-free editing math into the
 * app (ADR MA-0012, design DARKROOM_MOBILE.md §2 and §4: copy, never fork).
 *
 *   node scripts/sync-studio.mjs                  write src/studio/** (npm run studio:sync)
 *   node scripts/sync-studio.mjs --check          exit 1 when the committed copy drifts
 *   node scripts/sync-studio.mjs --web <path>     web repo (default ../media-manipulator-ui)
 *   node scripts/sync-studio.mjs --ref <git-ref>  read the web files from that ref (`git show`),
 *                                                 e.g. `--ref main` (env MM_WEB_REF is the same)
 *   --out <dir>                                   override src/studio (tests)
 *
 * The file set was found by scanning imports transitively from the ticket's list (MA61); a web file
 * that reaches a DOM / web-only module (authedFetch, Firebase, analytics, window, document,
 * indexedDB, localStorage) is NOT listed here, and EXCLUDED below records why.
 *
 * TypeScript files get a generated header; their `@/lib/...` and relative imports are rewritten to
 * the app copies. Two web-only imports are rewritten to the app's seam module instead
 * (`src/studio/mobile/backend.ts`, ticket MA61 decision 2), and the studio colour math / LUT parser
 * resolve to the copies Aperture already syncs into `src/photo/`. Everything else (JSON, .ass
 * goldens, README) is byte-copied. `src/studio/SOURCE.json` records the web commit and a SHA-256
 * per copied file.
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

const S = 'lib/studio';
const studio = (names, dir = S, out = '') =>
  Object.fromEntries(names.map((n) => [`${dir}/${n}.ts`, `${out}${n}.ts`]));

/** Single TypeScript files: web path -> app path (relative to the out dir). */
export const TS_FILES = {
  'lib/studioTypes.ts': 'studioTypes.ts',
  ...studio([
    // Timeline ops and their helpers.
    'timelineOps',
    'proTrim',
    'speed',
    'keyframes',
    'ease',
    'trackRules',
    'clipTrimBound',
    'titleConvert',
    // `titleFonts` is the title font registry; its two FontFace loaders are guarded by
    // `typeof document === 'undefined'` and are never called on the phone.
    'titleFonts',
    // Pure layout maths with an injected canvas context / measure function.
    'titleRaster',
    'effectRegistry',
    'looks',
    'audioPresets',
    'mixerMath',
    'duckingEnvelope',
    'trackAudibility',
    // Guards `navigator.onLine` (true outside browsers); the app injects `isOnline`.
    'saveState',
    // The active-clip resolver; its backend import is rewritten to the app seam (decision 2).
    'previewEngine',
    'proxyRebuild',
    'parityTolerances',
    'timelineWindow',
    'markerLayout',
    'playbackSync',
    'qualityGovernor',
    'versionCheckpoint',
    // The web's draft-recovery decision; its `StudioDraft` type import goes to the app's drafts.
    'draftRecovery',
    'devSynthetic',
  ]),
  ...studio(
    ['ass', 'units', 'respread', 'wordEdit', 'sanitize', 'captionLooks', 'analytics'],
    `${S}/captions`,
    'captions/',
  ),
  // A full v3 project the web's Medi op tests share (pure; imports only the model's types).
  'lib/assistant/ops/studioFixture.ts': 'fixtures/studioFixture.ts',
};

/**
 * The web's vitest suites whose imports stay inside the copied set; they run under jest through
 * the `vitest` shim (`src/studio/mobile/vitestShim.ts`, jest moduleNameMapper). Suites not listed
 * are in EXCLUDED_TESTS with the reason.
 */
export const TEST_FILES = {
  ...studio(
    [
      'audioPresets.test',
      'clipTrimBound.test',
      'devSynthetic.test',
      'draftRecovery.test',
      'duckingEnvelope.test',
      'ease.test',
      'markerLayout.test',
      'mixerMath.test',
      'playbackSync.test',
      'previewEngine.test',
      'proTrim.test',
      'qualityGovernor.test',
      'saveState.test',
      'speed.test',
      'timelineWindow.test',
      'titleConvert.test',
      'titleRaster.test',
      'trackAudibility.test',
      'trackRules.test',
      'versionCheckpoint.test',
    ],
    S,
  ),
  ...studio(
    ['captionLooks.test', 'effects.test', 'legacyRoundTrip.test', 'respread.test', 'wordEdit.test'],
    `${S}/captions`,
    'captions/',
  ),
};

/** Byte-copied single files (catalogs and vitest fixtures). */
export const RAW_FILES = {
  'lib/studio/captions/captionsCatalog.json': 'captions/captionsCatalog.json',
  'lib/studio/ease.fixtures.json': 'ease.fixtures.json',
  'lib/studio/trackAudibility.fixture.json': 'trackAudibility.fixture.json',
};

/** Directory trees copied byte for byte: web dir -> app dir. */
export const TREES = {
  // The Go/TS ASS golden pairs (cue JSON + expected .ass), checked by an app jest suite.
  'lib/studio/captions/goldens': 'captions/goldens',
};

/**
 * Web-only modules a copied file imports, rewritten to an app module with the same exports
 * (path relative to the out dir, no extension). Never a hand edit of the copy.
 */
export const SEAMS = {
  'lib/studio/studioBackend': 'mobile/backend',
  'lib/translator/mode': 'mobile/backend',
  // draftRecovery type-imports `StudioDraft`; the app's MMKV drafts export the same shape.
  'lib/studio/draftStore': 'mobile/drafts',
  // Already synced for Aperture (scripts/sync-photo-fixtures.mjs): reuse, never duplicate.
  'lib/studio/colorMath': '../photo/studioColorMath',
  'lib/studio/lutParser': '../photo/studioLutParser',
};

/** Web files deliberately not copied, and why (mirrored in the MA61 ticket log). */
export const EXCLUDED = {
  'lib/studio/studioBackend.ts': 'authedFetch, Firebase, analytics, fetch (replaced by the seam)',
  'lib/studio/studioBackendProvider.tsx': 'React context over studioBackend',
  'lib/studio/studioBackend.selfcheck.ts': 'studioBackend + the CreaTV embed protocol',
  'lib/studio/glCompositor.ts': 'WebGL2 / HTMLCanvasElement (ported to SkSL in MA62)',
  'lib/studio/imageCache.ts': 'fetch + createImageBitmap',
  'lib/studio/frameGrab.ts': 'HTMLCanvasElement / document',
  'lib/studio/draftStore.ts': 'IndexedDB (rewritten on MMKV: src/studio/mobile/drafts.ts)',
  'lib/studio/mediaBin.ts': 'window / localStorage',
  'lib/studio/preferences.ts': 'window / localStorage',
  'lib/studio/trackHeights.ts': 'localStorage',
  'lib/studio/keymap.ts': 'window (desktop keyboard map)',
  'lib/studio/commands.ts': 'the web Zustand store, telemetry, preferences, keymap',
  'lib/studio/telemetry.ts': 'web analytics client + window',
  'lib/studio/exportOptions.ts': 'studioOutputs -> accountApi (authedFetch); export is MA58',
  'lib/studio/studioOutputs.ts': 'accountApi (authedFetch)',
  'lib/studio/editorBridges.ts': 'exportOptions',
  'lib/studio/useExportOptions.ts': 'React Query + AuthProvider + fetch',
  'lib/studio/usePeaks.ts': 'React Query + fetch',
  'lib/studio/voiceoverGenerate.ts': 'React Query + fetch + voices API',
  'lib/studio/voiceover.ts': 'MediaRecorder helpers (web recorder only)',
  'lib/studio/embedProtocol.ts': 'CreaTV iframe postMessage contract',
  'lib/studio/audioBus.ts': 'Web Audio meter bridge',
  'lib/studio/binDrop.ts': 'dnd-kit bridge',
  'lib/studio/eyedropper.ts': 'WebGL canvas bridge',
  'lib/studio/speedDialog.ts': 'web dialog store',
  'lib/studio/captions/captionLooksApi.ts': 'React Query + authedFetch',
  'lib/studio/uploadQueue.ts':
    'DOM-free but not needed: the phone uploads through the MA12 transport',
  'lib/studio/captions/jassubPreview.ts': 'Worker / OffscreenCanvas / window (libass WASM)',
};

/** Web vitest suites not run under jest, and why. */
export const EXCLUDED_TESTS = {
  'lib/studio/captions/ass.test.ts':
    'reads goldens via process.cwd() + the API checkout; an app suite checks the copied goldens',
  'lib/studio/looks.test.ts': 'imports the web Zustand store and Medi recipes',
  'lib/studio/colorMath.test.ts': 'covered by the Aperture copy (src/photo)',
};

/**
 * Import specifiers in the copied TypeScript are resolved against the web tree (`@/x` = the web
 * repo root, `./x` = relative to the web file) and rewritten to the app copy, relative to the app
 * file. A specifier that resolves to something this sync does not copy is an error.
 */
export function resolveImport(spec, webPath, appPath) {
  let target;
  if (spec.startsWith('@/')) target = spec.slice(2);
  else if (spec.startsWith('.')) target = posix(join(dirname(webPath), spec));
  else return null; // a package import: left alone
  let app = null;
  if (RAW_FILES[target]) app = RAW_FILES[target];
  else if (TS_FILES[`${target}.ts`]) app = TS_FILES[`${target}.ts`].replace(/\.ts$/, '');
  else if (SEAMS[target]) app = SEAMS[target];
  if (!app) return undefined;
  let rel = posix(relative(dirname(appPath), app));
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

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

export function transformTs(src, webPath, appPath) {
  let text = src.toString('utf8');
  text = text.replace(/(from |import\()'([^']+)'/g, (whole, lead, spec) => {
    const to = resolveImport(spec, webPath, appPath);
    if (to === null) return whole;
    // The web resolves @/ to its repo root; anything we do not copy is an error.
    if (to === undefined) throw new Error(`${webPath}: unmapped import '${spec}'`);
    return `${lead}'${to}'`;
  });
  const header = [
    `// DO NOT EDIT. Copied from media-manipulator-ui ${webPath} by scripts/sync-studio.mjs`,
    '// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);',
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
  for (const [webPath, appPath] of Object.entries({ ...TS_FILES, ...TEST_FILES })) {
    const buf = source.read(webPath);
    if (!buf) {
      problems.push(`missing in web: ${webPath}`);
      continue;
    }
    try {
      files.set(appPath, transformTs(buf, webPath, appPath));
    } catch (e) {
      problems.push(e instanceof Error ? e.message : String(e));
    }
  }
  for (const [webPath, appPath] of Object.entries(RAW_FILES)) {
    const buf = source.read(webPath);
    if (!buf) problems.push(`missing in web: ${webPath}`);
    else files.set(appPath, buf);
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

/** Files under the out dir this sync would own (everything except the app's `mobile/` code). */
function ownedOnDisk(out) {
  if (!existsSync(out)) return [];
  return walk(out).filter((p) => !p.startsWith('mobile/') && p !== 'SOURCE.json');
}

export async function run(argv, { log = console.log, warn = console.warn } = {}) {
  const o = parseArgs(argv);
  const web = resolve(o.web ?? join(ROOT, '..', 'media-manipulator-ui'));
  const out = resolve(o.out ?? join(ROOT, 'src/studio'));
  if (!existsSync(web)) {
    if (o.check) {
      warn(`warning: web repo not found at ${web}; skipping studio sync check`);
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
    for (const rel of ownedOnDisk(out)) {
      if (!files.has(rel)) stale.push(`extra (not in web): ${rel}`);
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
      warn(`studio sync check FAILED (${stale.length}):`);
      for (const s of stale.slice(0, 50)) warn(`  ${s}`);
      warn('Run `npm run studio:sync` (and commit the result).');
      return 1;
    }
    log(`studio sync check OK (${files.size} files)`);
    return 0;
  }

  if (problems.length) {
    for (const p of problems) warn(`error: ${p}`);
    return 1;
  }
  for (const rel of ownedOnDisk(out)) rmSync(join(out, rel), { force: true });
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
  log(`synced ${files.size} studio files from ${source.webCommit.slice(0, 8)}`);
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
