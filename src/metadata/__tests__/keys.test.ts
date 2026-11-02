import { aboutKey, sanitizeKeySegment } from '../keys';

describe('sanitizeKeySegment', () => {
  it('replaces dots and colons', () => {
    expect(sanitizeKeySegment('com.apple.quicktime.make')).toBe('com_apple_quicktime_make');
    expect(sanitizeKeySegment('0:Display Matrix')).toBe('0_Display_Matrix');
  });
  it('leaves plain tags alone', () => {
    expect(sanitizeKeySegment('DateTimeOriginal')).toBe('DateTimeOriginal');
    expect(sanitizeKeySegment('OffsetTime*')).toBe('OffsetTime*');
  });
});

describe('aboutKey', () => {
  it('uses the group when the row has one', () => {
    expect(aboutKey({ group: 'XMP-exif', tag: 'DateTimeOriginal', category: 'xmp' })).toBe(
      'about.XMP-exif.DateTimeOriginal__xmp',
    );
  });
  it('disambiguates group-less rows by category', () => {
    expect(aboutKey({ tag: 'DateTimeOriginal', category: 'camera' })).toBe(
      'about._.DateTimeOriginal__camera',
    );
    expect(aboutKey({ tag: 'DateTimeOriginal', category: 'datetime' })).not.toBe(
      aboutKey({ tag: 'DateTimeOriginal', category: 'camera' }),
    );
  });
  it('never contains separators inside a segment', () => {
    const key = aboutKey({
      group: 'QuickTime',
      tag: 'com.apple.quicktime.make',
      category: 'apple',
    });
    expect(key.split('.')).toEqual(['about', 'QuickTime', 'com_apple_quicktime_make__apple']);
  });
});
