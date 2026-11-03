#!/usr/bin/env node
// Usage: node scripts/bump-version.mjs <major|minor|patch>
// Edits package.json (+ package-lock.json root entry) and APP_VERSION in app.config.ts. The Android versionCode /
// iOS buildNumber are NOT touched: EAS manages them remotely (eas.json appVersionSource "remote", autoIncrement).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { bump } = createRequire(import.meta.url)('./bump-core.cjs');

function main() {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const pkgPath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const next = bump(pkg.version, process.argv[2]);
  const rewrite = (file, fn) => {
    const p = path.join(root, file);
    if (fs.existsSync(p)) fs.writeFileSync(p, fn(fs.readFileSync(p, 'utf8')));
  };
  rewrite('package.json', (s) => s.replace(/("version": ")[^"]+(")/, `$1${next}$2`));
  rewrite('package-lock.json', (s) => {
    const lock = JSON.parse(s);
    lock.version = next;
    if (lock.packages?.['']) lock.packages[''].version = next;
    return `${JSON.stringify(lock, null, 2)}\n`;
  });
  rewrite('app.config.ts', (s) =>
    s.replace(/(export const APP_VERSION = ')[^']+(')/, `$1${next}$2`),
  );
  console.log(`${pkg.version} -> ${next}`);
  console.log(
    'Reminder: a native change (new/updated native module, plugin or permission) needs a new store build,',
  );
  console.log(
    'not an OTA. Run `npx expo-updates fingerprint:generate` to check; versionCode is EAS-managed (autoIncrement).',
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
