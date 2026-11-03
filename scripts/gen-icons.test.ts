import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const script = path.join(__dirname, 'gen-icons.mjs');
const run = (...args: string[]) =>
  spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

describe('gen-icons', () => {
  it('check passes on the committed assets', () => {
    expect(run('--check').status).toBe(0);
  });

  it('check fails on a modified PNG', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-icons-'));
    try {
      execFileSync(process.execPath, [script, '--dir', dir]);
      expect(run('--check', '--dir', dir).status).toBe(0);
      // A different (still valid) PNG of the right size: a 1x1 PNG header-swap would fail on size alone, so
      // overwrite with the monochrome render to prove the pixel compare catches it.
      fs.copyFileSync(path.join(dir, 'monochrome.png'), path.join(dir, 'adaptive-foreground.png'));
      const r = run('--check', '--dir', dir);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('adaptive-foreground.png');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
