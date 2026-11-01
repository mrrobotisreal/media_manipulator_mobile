import type { ResultKind } from '../describe';
import { isShareable } from '../shareable';

describe('isShareable (port of the web shareApi cases)', () => {
  it.each([
    'image',
    'gif',
    'video',
    'audio',
    'transcript',
    'captions',
    'pdf',
    'archive',
    'hls',
    'dash',
  ] as ResultKind[])('allows %s', (kind) => expect(isShareable(kind)).toBe(true));
  it.each(['metadata', 'summary', 'unknown'] as ResultKind[])('refuses %s', (kind) =>
    expect(isShareable(kind)).toBe(false),
  );
  it('refuses Darkroom and metadata-inspector tools or modes, case-insensitively', () => {
    expect(isShareable('video', 'studio_export')).toBe(false);
    expect(isShareable('video', 'Studio')).toBe(false);
    expect(isShareable('archive', null, 'inspect_metadata')).toBe(false);
    expect(isShareable('pdf', 'metadata_report')).toBe(false);
  });
  it('ignores unrelated or missing labels', () => {
    expect(isShareable('image', undefined, null, 'image_converter', 'convert')).toBe(true);
  });
});
