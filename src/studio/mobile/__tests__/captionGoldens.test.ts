/**
 * The web's `captions/ass.test.ts` reads its goldens through `process.cwd()` and the API checkout,
 * so it is not copied (scripts/sync-studio.mjs EXCLUDED_TESTS). This is the same golden check on
 * the copied files: the copied `buildASS` reproduces every Go/TS `.ass` golden byte for byte.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildASS } from '../../captions/ass';
import type { StudioCaptionCue, StudioCaptionStyle } from '../../studioTypes';

const DIR = join(__dirname, '..', '..', 'captions', 'goldens');
const names = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.slice(0, -5))
  .sort();

interface Fixture {
  width: number;
  height: number;
  style: StudioCaptionStyle | null;
  cues: StudioCaptionCue[];
}

describe('caption ASS goldens on the phone (copied buildASS == committed .ass)', () => {
  it('has the web fixture count (MM121 18 + MM122 12)', () => {
    expect(names.length).toBeGreaterThanOrEqual(30);
  });

  it.each(names)('%s', (name) => {
    const fx = JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8')) as Fixture;
    const want = readFileSync(join(DIR, `${name}.ass`), 'utf8');
    expect(buildASS(fx.cues, fx.style, fx.width, fx.height)).toBe(want);
  });
});
