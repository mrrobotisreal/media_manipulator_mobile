/**
 * Fixture file lists (see README.md). Tests read the directories through
 * these helpers so a new file is picked up without editing a list.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const FIXTURES_DIR = __dirname;

const list = (dir: string, ext: string) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .sort();

const isInvalid = (f: string) => f.startsWith('invalid-') || f === 'oversize-brush.json';

/** Canonical documents: the shared contract with the Go sanitizer. */
export const docFixtures = () => list(join(FIXTURES_DIR, 'docs'), '.json').filter((f) => !isInvalid(f));
/** Documents the schema must refuse. */
export const invalidFixtures = () => list(join(FIXTURES_DIR, 'docs'), '.json').filter(isInvalid);
/** Non-canonical inputs that must parse to a canonical fixture. */
export const inputFixtures = () => list(join(FIXTURES_DIR, 'inputs'), '.json');
/** Source images for the goldens. */
export const imageFixtures = () => list(join(FIXTURES_DIR, 'images'), '.png');

export const readFixture = (...parts: string[]) => readFileSync(join(FIXTURES_DIR, ...parts), 'utf8');
