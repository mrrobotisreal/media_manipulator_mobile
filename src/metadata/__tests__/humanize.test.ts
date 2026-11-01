import { humanizeTag, streamLabel } from '../humanize';

describe('humanizeTag', () => {
  it.each([
    ['DateTimeOriginal', 'Date/time original'],
    ['GPSLatitude', 'GPS latitude'],
    ['GPSLatitudeRef', 'GPS latitude ref'],
    ['ISO', 'ISO'],
    ['XResolution', 'X resolution'],
    ['ExposureTime', 'Exposure time'],
    ['MIMEType', 'MIME type'],
    ['FileModifyDate', 'File modify date'],
    ['BodySerialNumber', 'Body serial number'],
    ['major_brand', 'Major brand'],
    ['bit_rate', 'Bit rate'],
    ['ImageWidth', 'Image width'],
    ['0x004f', '0x004f'],
  ])('%s -> %s', (raw, expected) => {
    expect(humanizeTag(raw)).toBe(expected);
  });

  it('handles reverse-DNS keys', () => {
    expect(humanizeTag('com.apple.quicktime.make')).toBe('Make (Apple QuickTime)');
    expect(humanizeTag('com.apple.quicktime.location.ISO6709')).toBe(
      'ISO 6709 (Apple QuickTime Location)',
    );
  });

  it('handles digits', () => {
    expect(humanizeTag('Tag2Value')).toBe('Tag 2 value');
  });

  it('labels side data with its stream', () => {
    expect(humanizeTag('0:Display Matrix')).toBe('Display matrix (stream 0)');
  });

  it('never returns an empty string', () => {
    expect(humanizeTag('---')).not.toBe('');
  });
});

describe('streamLabel', () => {
  it('uses the codec type', () => {
    expect(streamLabel('Stream:0', 'video')).toBe('Video stream 0');
    expect(streamLabel('Stream:1', 'audio')).toBe('Audio stream 1');
  });
  it('falls back without a type', () => {
    expect(streamLabel('Stream:2')).toBe('Stream 2');
  });
  it('numbers chapters from 1 and passes other groups through', () => {
    expect(streamLabel('Chapter:0')).toBe('Chapter 1');
    expect(streamLabel('ExifIFD')).toBe('ExifIFD');
  });
});
