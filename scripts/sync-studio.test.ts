import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const script = path.join(__dirname, 'sync-studio.mjs');
const web = path.join(__dirname, '..', '..', 'media-manipulator-ui');
const run = (...args: string[]) =>
  spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const hasWeb = fs.existsSync(path.join(web, 'lib', 'studioTypes.ts'));

describe('sync-studio', () => {
  (hasWeb ? it : it.skip)(
    'writes a copy that --check accepts, rewrites the seams, and --check catches drift',
    () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-sync-'));
      try {
        // Working tree, not a ref: the test must not depend on the UI repo's branch state.
        expect(run('--web', web, '--out', dir).status).toBe(0);
        expect(run('--check', '--web', web, '--out', dir).status).toBe(0);
        const engine = fs.readFileSync(path.join(dir, 'previewEngine.ts'), 'utf8');
        expect(
          engine.startsWith(
            '// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/previewEngine.ts',
          ),
        ).toBe(true);
        expect(engine).toContain("from './mobile/backend'");
        for (const f of ['previewEngine.ts', 'timelineOps.ts', 'captions/ass.ts']) {
          expect(fs.readFileSync(path.join(dir, f), 'utf8')).not.toMatch(/from '@\//);
        }
        // App code under mobile/ is never touched or reported by the sync.
        fs.mkdirSync(path.join(dir, 'mobile'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'mobile', 'mine.ts'), 'export {};\n');
        expect(run('--check', '--web', web, '--out', dir).status).toBe(0);

        fs.appendFileSync(path.join(dir, 'speed.ts'), ' ');
        fs.writeFileSync(path.join(dir, 'extra.ts'), 'export {};\n');
        const r = run('--check', '--web', web, '--out', dir);
        expect(r.status).toBe(1);
        expect(r.stderr).toContain('drifted: speed.ts');
        expect(r.stderr).toContain('extra (not in web): extra.ts');

        expect(run('--web', web, '--out', dir).status).toBe(0);
        expect(fs.existsSync(path.join(dir, 'extra.ts'))).toBe(false);
        expect(fs.existsSync(path.join(dir, 'mobile', 'mine.ts'))).toBe(true);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it('skips the check (exit 0) when the web repo is absent, like the photo sync', () => {
    const r = run('--check', '--web', path.join(os.tmpdir(), 'no-such-web-repo'));
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('skipping studio sync check');
  });
});
