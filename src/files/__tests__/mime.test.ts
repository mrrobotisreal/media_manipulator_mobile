import { extensionOf, resolveKind, resolveMime, sanitizeName } from '../mime';

describe('mime', () => {
  it('extensionOf lower-cases and handles odd names', () => {
    expect(extensionOf('IMG_001.JPG')).toBe('jpg');
    expect(extensionOf('archive.tar.gz')).toBe('gz');
    expect(extensionOf('noext')).toBe('');
    expect(extensionOf('.hidden')).toBe('');
    expect(extensionOf('trailing.')).toBe('');
    expect(extensionOf('a/b/c.PDF')).toBe('pdf');
  });

  it('resolveMime keeps a real MIME and infers from the extension when missing or generic', () => {
    expect(resolveMime('image/png', 'png')).toBe('image/png');
    expect(resolveMime('IMAGE/PNG', 'png')).toBe('image/png');
    expect(resolveMime(undefined, 'mp3')).toBe('audio/mpeg');
    expect(resolveMime('application/octet-stream', 'mov')).toBe('video/quicktime');
    expect(resolveMime('application/octet-stream', 'zip')).toBe('');
  });

  it('resolveKind uses the MIME prefix, then the extension; pdf maps to pdf', () => {
    expect(resolveKind('image/heic', 'heic')).toBe('image');
    expect(resolveKind('video/mp4', 'mp4')).toBe('video');
    expect(resolveKind('audio/mpeg', 'mp3')).toBe('audio');
    expect(resolveKind('application/pdf', 'pdf')).toBe('pdf');
    expect(resolveKind('', 'pdf')).toBe('pdf');
    expect(resolveKind('', 'wav')).toBe('audio');
    expect(resolveKind('application/zip', 'zip')).toBeNull();
    expect(resolveKind('text/plain', 'txt')).toBeNull();
  });

  it('sanitizeName strips separators and control characters and bounds the length', () => {
    expect(sanitizeName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeName('a:b*c?.jpg')).toBe('a_b_c_.jpg');
    expect(sanitizeName('   ')).toBe('file');
    const long = sanitizeName(`${'x'.repeat(300)}.png`);
    expect(long.length).toBeLessThanOrEqual(100);
    expect(long.endsWith('.png')).toBe(true);
  });
});
