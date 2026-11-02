import {
  CHAR_DIFF_LIMIT,
  diffChars,
  diffToText,
  formatNumericChange,
  isExpectedChange,
  numericDelta,
  type CharOp,
} from '../diff-text';
import type { MetadataEntry } from '../types';

const join = (ops: CharOp[], keep: CharOp['type'][]) =>
  ops
    .filter((o) => keep.includes(o.type))
    .map((o) => o.text)
    .join('');
const roundTrip = (a: string, b: string) => {
  const ops = diffChars(a, b);
  expect(join(ops, ['equal', 'remove'])).toBe(a);
  expect(join(ops, ['equal', 'add'])).toBe(b);
  return ops;
};

describe('diffChars', () => {
  it('identical strings are one equal run', () => {
    expect(diffChars('abc', 'abc')).toEqual([{ type: 'equal', text: 'abc' }]);
    expect(diffChars('', '')).toEqual([]);
  });
  it('full replace', () => {
    const ops = roundTrip('abc', 'xyz');
    expect(ops.some((o) => o.type === 'equal')).toBe(false);
  });
  it('prefix and suffix insert', () => {
    expect(roundTrip('world', 'hello world')).toEqual([
      { type: 'add', text: 'hello ' },
      { type: 'equal', text: 'world' },
    ]);
    expect(roundTrip('hello', 'hello!')).toEqual([
      { type: 'equal', text: 'hello' },
      { type: 'add', text: '!' },
    ]);
  });
  it('middle edit keeps common parts', () => {
    const ops = roundTrip('kitten', 'sitting');
    expect(
      ops
        .filter((o) => o.type === 'equal')
        .map((o) => o.text)
        .join(''),
    ).toBe('ittn');
  });
  it('handles unicode without splitting code points', () => {
    const ops = roundTrip('привет 😀 мир', 'привет 😎 мир');
    expect(ops.find((o) => o.type === 'remove')?.text).toBe('😀');
    expect(ops.find((o) => o.type === 'add')?.text).toBe('😎');
    roundTrip('Москва', 'Москвa');
  });
  it('falls back to a whole replace above the limit', () => {
    const a = 'a'.repeat(600);
    const b = 'b'.repeat(Math.ceil(CHAR_DIFF_LIMIT / 600) + 1);
    expect(a.length * b.length).toBeGreaterThan(CHAR_DIFF_LIMIT);
    expect(diffChars(a, b)).toEqual([
      { type: 'remove', text: a },
      { type: 'add', text: b },
    ]);
  });
});

describe('numericDelta', () => {
  it('computes a delta for numbers and numeric strings', () => {
    expect(numericDelta(1.8, 2.8)).toEqual({ from: 1.8, to: 2.8, delta: 1 });
    expect(formatNumericChange('100', '80')).toBe('100 → 80 (-20)');
  });
  it('is undefined for non-numeric input', () => {
    expect(numericDelta('1/120', 2)).toBeUndefined();
    expect(formatNumericChange('a', 'b')).toBeUndefined();
  });
});

describe('isExpectedChange', () => {
  it('mirrors the Go list', () => {
    for (const id of [
      'System:FileName',
      'File:FileSize',
      'System:FileModifyDate',
      'File:MIMEType',
      'File:FileType',
      'System:FileTypeExtension',
      'Composite:ImageSize',
      'System:FileName#2',
    ])
      expect(isExpectedChange(id)).toBe(true);
    for (const id of [
      'IFD0:Make',
      'Composite:Megapixels',
      'ExifIFD:FileSource',
      'XMP:FileName',
      'nogroup',
      'System:',
    ]) {
      expect(isExpectedChange(id)).toBe(false);
    }
  });
});

const e = (
  group: string,
  tag: string,
  value: MetadataEntry['value'],
  category: string,
): MetadataEntry => ({
  id: `${group}:${tag}`,
  group,
  tag,
  value,
  category,
});

describe('diffToText', () => {
  it('matches the golden output for a 6-entry fixture', () => {
    const text = diffToText(
      {
        removed: [
          e('IFD0', 'Make', 'Apple', 'image'),
          e('GPS', 'GPSLatitude', '37 deg', 'gps'),
          e('GPS', 'GPSLongitude', '122 deg', 'gps'),
        ],
        added: [e('XMP', 'CreatorTool', 'mm', 'xmp')],
        changed: [
          { id: 'ExifIFD:ISO', before: 80, after: 100 },
          { id: 'IFD0:Software', before: '17.4.1', after: 'ImageMagick' },
        ],
        unchanged: 12,
      },
      { original: 'IMG_0001.jpg', result: 'IMG_0001.clean.jpg' },
      {
        categoryOf: (id) => (id.startsWith('ExifIFD') ? 'camera' : 'image'),
        mentionUnchanged: true,
      },
    );
    expect(text).toBe(
      [
        '--- IMG_0001.jpg',
        '+++ IMG_0001.clean.jpg',
        '@@ image @@',
        '- IFD0:Make: Apple',
        '~ IFD0:Software: 17.4.1 → ImageMagick',
        '@@ gps @@',
        '- GPS:GPSLatitude: 37 deg',
        '- GPS:GPSLongitude: 122 deg',
        '@@ xmp @@',
        '+ XMP:CreatorTool: mm',
        '@@ camera @@',
        '~ ExifIFD:ISO: 80 → 100 (+20)',
        '# 12 unchanged',
        '',
      ].join('\n'),
    );
  });
  it('omits kinds the filters hide', () => {
    const text = diffToText(
      { removed: [e('IFD0', 'Make', 'Apple', 'image')], added: [], changed: [], unchanged: 0 },
      { original: 'a', result: 'b' },
      { show: { removed: false } },
    );
    expect(text).toBe('--- a\n+++ b\n');
  });
});
