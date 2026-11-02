import {
  extractCoordinates,
  formatBytes,
  formatCoordinates,
  formatDuration,
  formatExifDate,
  formatValue,
  formatValueText,
  toDMS,
} from '../format';
import type { MetadataEntry } from '../types';

const e = (
  group: string,
  tag: string,
  value: MetadataEntry['value'],
  extra: Partial<MetadataEntry> = {},
): MetadataEntry => ({
  id: `${group}:${tag}`,
  group,
  tag,
  value,
  category: 'other',
  ...extra,
});

describe('formatExifDate', () => {
  it('formats zone-less dates as wall-clock time', () => {
    const out = formatExifDate('2026:09:30 18:42:10', 'en-US');
    expect(out).toContain('2026');
    expect(out).toMatch(/6:42:10\s?PM/);
  });
  it('keeps the file offset visible', () => {
    const out = formatExifDate('2026:09:30 18:42:10+02:00', 'en-US');
    expect(out).toMatch(/6:42:10\s?PM/);
    expect(out).toContain('(UTC+02:00)');
  });
  it('rejects non dates and zero dates', () => {
    expect(formatExifDate('hello')).toBeUndefined();
    expect(formatExifDate('0000:00:00 00:00:00')).toBeUndefined();
  });
});

describe('formatBytes / formatDuration', () => {
  it('formats sizes', () => {
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(12698)).toBe('12.4 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
  it('formats durations', () => {
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(-1)).toBe('');
  });
});

describe('GPS', () => {
  it('converts to DMS with hemispheres', () => {
    expect(toDMS(37.774972, 'lat')).toBe('37°46′29.9″ N');
    expect(toDMS(-122.419417, 'lon')).toBe('122°25′9.9″ W');
  });
  it('formats decimal plus DMS', () => {
    const c = formatCoordinates(37.774972, -122.419417);
    expect(c.decimal).toBe('37.774972, -122.419417');
    expect(c.dms).toContain('N');
  });
  it('prefers Composite raw decimals, else GPS rawValue', () => {
    expect(
      extractCoordinates([
        e('Composite', 'GPSLatitude', '37 deg', { rawValue: 37.5 }),
        e('Composite', 'GPSLongitude', '122 deg', { rawValue: -122.5 }),
        e('GPS', 'GPSLatitude', '1 deg', { rawValue: 1 }),
        e('GPS', 'GPSLongitude', '2 deg', { rawValue: 2 }),
      ]),
    ).toEqual({ lat: 37.5, lon: -122.5 });
    expect(
      extractCoordinates([
        e('GPS', 'GPSLatitude', 'x', { rawValue: 10 }),
        e('GPS', 'GPSLongitude', 'x', { rawValue: -20 }),
      ]),
    ).toEqual({ lat: 10, lon: -20 });
  });
  it('rejects absent or out of range coordinates', () => {
    expect(extractCoordinates([])).toBeUndefined();
    expect(
      extractCoordinates([
        e('GPS', 'GPSLatitude', 'x', { rawValue: 99 }),
        e('GPS', 'GPSLongitude', 'x', { rawValue: 0 }),
      ]),
    ).toBeUndefined();
  });
});

describe('formatValue', () => {
  it('shows exposure rationals as seconds', () => {
    expect(formatValue(e('ExifIFD', 'ExposureTime', '1/250'))).toEqual({
      kind: 'text',
      text: '1/250 s',
    });
    expect(formatValue(e('ExifIFD', 'ExposureTime', 'x', { rawValue: 0.004 }))).toEqual({
      kind: 'text',
      text: '1/250 s',
    });
    expect(formatValue(e('ExifIFD', 'ExposureTime', 2))).toEqual({ kind: 'text', text: '2 s' });
  });
  it('formats aperture and focal length', () => {
    expect(formatValue(e('ExifIFD', 'FNumber', 1.8))).toEqual({ kind: 'text', text: 'f/1.8' });
    expect(formatValue(e('ExifIFD', 'FocalLength', '6.9 mm'))).toEqual({
      kind: 'text',
      text: '6.9 mm',
    });
  });
  it('formats GPS entries from rawValue', () => {
    const v = formatValue(e('GPS', 'GPSLatitude', '37 deg 46', { rawValue: 37.774972 }));
    expect(v).toMatchObject({ kind: 'text' });
    expect((v as { text: string }).text).toContain('37.774972');
  });
  it('formats binary entries', () => {
    const v = formatValue(e('IFD1', 'ThumbnailImage', { bytes: 12698 }, { binary: true }));
    expect(v).toEqual({ kind: 'binary', bytes: 12698, text: 'Binary · 12.4 KB' });
  });
  it('keeps the original date in the title', () => {
    const v = formatValue(e('IFD0', 'ModifyDate', '2026:09:30 18:42:11'), 'en-US');
    expect(v).toMatchObject({ kind: 'text', title: '2026:09:30 18:42:11' });
  });
  it('turns scalar arrays into capped chips', () => {
    const v = formatValue(
      e(
        'XMP-dc',
        'Subject',
        Array.from({ length: 15 }, (_, i) => `k${i}`),
      ),
    );
    expect(v).toMatchObject({ kind: 'chips', more: 3 });
    expect((v as { items: string[] }).items).toHaveLength(12);
  });
  it('passes objects through for nested rendering', () => {
    expect(formatValue(e('XMP-x', 'Struct', { a: 1 }))).toEqual({
      kind: 'object',
      value: { a: 1 },
    });
  });
  it('formats ffprobe durations and booleans', () => {
    expect(formatValue(e('Format', 'duration', '75.5'))).toMatchObject({ text: '1:16' });
    expect(formatValue(e('X', 'Flag', true))).toEqual({ kind: 'text', text: 'Yes' });
  });
  it('renders text equivalents', () => {
    expect(formatValueText(e('IFD1', 'ThumbnailImage', { bytes: 2048 }, { binary: true }))).toBe(
      'Binary · 2.0 KB',
    );
    expect(formatValueText(e('X', 'Y', ['a', 'b']))).toBe('a, b');
  });
});
