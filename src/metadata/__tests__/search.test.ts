import { buildSearchIndex, searchEntries, tokenize } from '../search';
import type { MetadataEntry } from '../types';

const entries: MetadataEntry[] = [
  {
    id: 'IFD0:Make',
    group: 'IFD0',
    tag: 'Make',
    value: 'Apple',
    category: 'image',
    privacy: 'device',
  },
  {
    id: 'ExifIFD:DateTimeOriginal',
    group: 'ExifIFD',
    tag: 'DateTimeOriginal',
    value: '2026:09:30 18:42:10',
    category: 'camera',
  },
  {
    id: 'GPS:GPSLatitude',
    group: 'GPS',
    tag: 'GPSLatitude',
    value: '37 deg',
    rawValue: 37.7,
    category: 'gps',
  },
];

describe('search', () => {
  const index = buildSearchIndex(entries, {
    locale: 'en-US',
    describe: (e) => (e.tag === 'Make' ? 'Camera manufacturer' : undefined),
  });

  it('returns null for an empty query', () => {
    expect(searchEntries(index, '   ')).toBeNull();
    expect(tokenize(' A  b ')).toEqual(['a', 'b']);
  });
  it('matches humanized name, raw tag, value and description', () => {
    expect(searchEntries(index, 'date/time')).toEqual(new Set(['ExifIFD:DateTimeOriginal']));
    expect(searchEntries(index, 'gpslatitude')).toEqual(new Set(['GPS:GPSLatitude']));
    expect(searchEntries(index, 'apple')).toEqual(new Set(['IFD0:Make']));
    expect(searchEntries(index, 'manufacturer')).toEqual(new Set(['IFD0:Make']));
  });
  it('ANDs tokens', () => {
    expect(searchEntries(index, 'apple make')).toEqual(new Set(['IFD0:Make']));
    expect(searchEntries(index, 'apple gps')).toEqual(new Set());
  });
  it('searches 1,500 entries in under 10 ms', () => {
    const big: MetadataEntry[] = Array.from({ length: 1500 }, (_, i) => ({
      id: `G${i % 30}:Tag${i}`,
      group: `G${i % 30}`,
      tag: `Tag${i}`,
      value: `value number ${i}`,
      category: 'other',
    }));
    const bigIndex = buildSearchIndex(big);
    searchEntries(bigIndex, 'warm up');
    // Best of five: a single sample flakes when the full suite loads the CPU.
    let elapsed = Infinity;
    let hits: Set<string> | null = null;
    for (let run = 0; run < 5; run++) {
      const start = performance.now();
      hits = searchEntries(bigIndex, 'number 14');
      elapsed = Math.min(elapsed, performance.now() - start);
    }
    expect(hits?.size).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(10);
  });
});
