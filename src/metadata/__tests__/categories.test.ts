import { countByPrivacy, defaultOpen, groupByCategory, hasOnlyBasicInfo } from '../categories';
import type { MetadataEntry } from '../types';

const e = (id: string, category: string, privacy?: string, group = 'X'): MetadataEntry => ({
  id,
  group,
  tag: id,
  value: id,
  category,
  privacy,
});

describe('groupByCategory', () => {
  it('orders per design 3.3 with unknown ids last', () => {
    const groups = groupByCategory([
      e('a', 'other'),
      e('b', 'gps'),
      e('c', 'file'),
      e('d', 'zzz'),
      e('e', 'camera'),
    ]);
    expect(groups.map((g) => g.id)).toEqual(['file', 'camera', 'gps', 'other', 'zzz']);
  });
  it('keeps entry order and collects privacy', () => {
    const [g] = groupByCategory([
      e('a', 'gps', 'location'),
      e('b', 'gps'),
      e('c', 'gps', 'identity'),
    ]);
    expect(g!.entries.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(g!.privacy).toEqual(['location', 'identity']);
  });
});

describe('helpers', () => {
  it('defaultOpen is limited to present categories', () => {
    expect(defaultOpen(new Set(['file', 'gps', 'xmp']))).toEqual(['file', 'gps']);
  });
  it('counts privacy and ignores unknown classes', () => {
    expect(
      countByPrivacy([e('a', 'x', 'location'), e('b', 'x', 'location'), e('c', 'x', 'weird')]),
    ).toEqual({
      location: 2,
      identity: 0,
      device: 0,
      history: 0,
    });
  });
  it('detects documents with only basic info', () => {
    expect(
      hasOnlyBasicInfo([
        e('a', 'file', '', 'System'),
        e('b', 'file', '', 'File'),
        e('c', 'x', '', 'Format'),
      ]),
    ).toBe(true);
    expect(hasOnlyBasicInfo([e('a', 'file', '', 'System'), e('b', 'camera', '', 'ExifIFD')])).toBe(
      false,
    );
  });
});
