import { buildCatalogIndex } from '../catalog';
import { buildRows } from '../rows';
import type { MetadataEntry } from '../types';

const catalog = buildCatalogIndex({
  schemaVersion: 1,
  categories: [],
  tags: [
    {
      group: 'ExifIFD',
      tag: 'DateTimeOriginal',
      aliases: [],
      description: 'When the photo was taken.',
      privacy: 'history',
      category: 'camera',
      unverified: false,
    },
  ],
});
const e = (
  group: string,
  tag: string,
  value: MetadataEntry['value'],
  category = 'other',
): MetadataEntry => ({
  id: `${group}:${tag}`,
  group,
  tag,
  value,
  category,
});

describe('buildRows', () => {
  const rows = buildRows(
    [
      e('ExifIFD', 'DateTimeOriginal', '2026:09:30 18:42:10', 'camera'),
      e('Nikon', 'ZzzNotARealTag', 'x'),
      e('Stream:0', 'StreamType', 'video'),
      e('Stream:0', 'codec_name', 'h264'),
    ],
    { catalog, describe: (r) => `DESC:${r.description}`, locale: 'en-US' },
  );

  it('attaches descriptions for known tags and none for unknown', () => {
    expect(rows[0]!.about?.text).toMatch(/^DESC:/);
    expect(rows[1]!.about).toBeUndefined();
  });
  it('humanizes labels and labels streams by codec type', () => {
    expect(rows[0]!.label).toBe('Date/time original');
    expect(rows[3]!.groupLabel).toBe('Video stream 0');
  });
  it('formats values once', () => {
    expect(rows[0]!.formatted.kind).toBe('text');
    expect(rows[0]!.text).toContain('2026');
  });
});
