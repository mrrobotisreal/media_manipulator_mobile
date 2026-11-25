/**
 * The web compositor copy (`src/studio/compositor/glCompositor.ts`) and the parity data
 * (`src/studio/parity/`) are test references: app code never imports them (the phone's compositor
 * is the SkSL port). `buildLayers.ts` is the one copy app code may use (pure EDL -> layers).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..', '..', '..', '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

it('no app file imports glCompositor or src/studio/parity', () => {
  const offenders = walk(SRC)
    .filter((p) => !/__tests__|\/testing\/|\.test\.tsx?$/.test(p))
    .filter((p) => !p.includes(`${join('studio', 'compositor')}/`) && !p.includes(`${join('studio', 'parity')}/`))
    .filter((p) => /from '[^']*(glCompositor|studio\/parity|\.\.\/parity)[^']*'/.test(readFileSync(p, 'utf8')))
    .map((p) => relative(SRC, p));
  expect(offenders).toEqual([]);
});
