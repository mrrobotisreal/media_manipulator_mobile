import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const script = path.join(__dirname, 'sync-photo-fixtures.mjs');
const web = path.join(__dirname, '..', '..', 'media-manipulator-ui');
const run = (...args: string[]) =>
  spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const hasWeb = fs.existsSync(path.join(web, 'lib', 'photo', 'photoTypes.ts'));

describe('sync-photo-fixtures', () => {
  (hasWeb ? it : it.skip)('writes a copy that --check accepts, and --check catches drift', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-sync-'));
    try {
      // Working tree, not a ref: the test must not depend on the UI repo's branch state.
      expect(run('--web', web, '--out', dir).status).toBe(0);
      expect(run('--check', '--web', web, '--out', dir).status).toBe(0);
      const types = fs.readFileSync(path.join(dir, 'photoTypes.ts'), 'utf8');
      expect(types.startsWith('// DO NOT EDIT. Copied from media-manipulator-ui lib/photo/photoTypes.ts')).toBe(true);
      const math = fs.readFileSync(path.join(dir, 'colorMath.ts'), 'utf8');
      expect(math).toContain("from './studioColorMath'");
      expect(math).not.toMatch(/from '@\//);

      fs.appendFileSync(path.join(dir, 'fixtures', 'docs', 'blank.json'), ' ');
      fs.writeFileSync(path.join(dir, 'fixtures', 'docs', 'extra.json'), '{}');
      const r = run('--check', '--web', web, '--out', dir);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('drifted: fixtures/docs/blank.json');
      expect(r.stderr).toContain('extra (not in web): fixtures/docs/extra.json');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips the check (exit 0) when the web repo is absent, like the i18n sync', () => {
    const r = run('--check', '--web', path.join(os.tmpdir(), 'no-such-web-repo'));
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('skipping photo fixture sync check');
  });
});
