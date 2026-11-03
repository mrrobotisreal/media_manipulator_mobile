import fs from 'node:fs';
import path from 'node:path';
import catalog from '../../../__fixtures__/analytics-catalog.fixture.json';
import { EVENTS, EVENT_PRIORITY, FORBIDDEN_PROP_KEYS } from '../events';

const ROOT = path.resolve(__dirname, '../../..');
const EVENTS_TS = fs.readFileSync(path.join(ROOT, 'src/analytics/events.ts'), 'utf8');

/** Same reading the analytics repo's parity parser does: interface name -> keys, then EventPropsMap. */
function propKeysByEvent(): Record<string, string[]> {
  const ifaces: Record<string, string[]> = {};
  for (const m of EVENTS_TS.matchAll(/export interface (\w+) \{([\s\S]*?)\n\}/g)) {
    ifaces[m[1]!] = [...m[2]!.matchAll(/^\s+(?:readonly )?([a-zA-Z_][a-zA-Z0-9_]*)\??:/gm)].map(
      (k) => k[1]!,
    );
  }
  for (const m of EVENTS_TS.matchAll(/export type (\w+) = Record<string, never>;/g))
    ifaces[m[1]!] = [];
  const map = /export interface EventPropsMap \{([\s\S]*?)\n\}/.exec(EVENTS_TS)![1]!;
  const out: Record<string, string[]> = {};
  for (const m of map.matchAll(/^\s+([a-z0-9_]+): (\w+);/gm)) out[m[1]!] = ifaces[m[2]!]!;
  return out;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !p.includes('__tests__'))
      out.push(p);
  }
  return out;
}

describe('events.ts (catalog mirror)', () => {
  const fixture = catalog as unknown as Record<
    string,
    { priority: number; props: string[] | null }
  >;
  const names = Object.values(EVENTS);

  it('every name is in the catalog with the same priority', () => {
    for (const name of names) {
      expect(fixture[name]).toBeDefined();
      expect([name, EVENT_PRIORITY[name]]).toEqual([name, fixture[name]!.priority]);
    }
    expect(Object.keys(EVENT_PRIORITY).sort()).toEqual([...names].sort());
  });

  it('every typed property is a catalog KnownProp', () => {
    const keys = propKeysByEvent();
    for (const name of names) {
      expect(keys[name]).toBeDefined();
      for (const k of keys[name]!)
        expect([name, fixture[name]!.props ?? []]).toEqual([name, expect.arrayContaining([k])]);
    }
  });

  it('no property can carry a file name, path, email or display name', () => {
    const keys = propKeysByEvent();
    for (const name of names) {
      for (const k of keys[name]!) expect(FORBIDDEN_PROP_KEYS).not.toContain(k);
    }
  });

  it('no inline string event names passed to track in app/ or src/', () => {
    const offenders: string[] = [];
    for (const f of [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'src'))]) {
      const src = fs.readFileSync(f, 'utf8');
      if (/\btrack\(\s*['"`]/.test(src)) offenders.push(path.relative(ROOT, f));
    }
    expect(offenders).toEqual([]);
  });
});
