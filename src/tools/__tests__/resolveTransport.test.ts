import { resolveTransport } from '../resolveTransport';
import type { MediaKind, ToolEndpoint } from '../types';

describe('resolveTransport', () => {
  const cases: [ToolEndpoint, MediaKind, string][] = [
    ['upload', 'image', 'upload'],
    ['upload', 'video', 'upload'],
    ['presign', 'video', 'presign'],
    ['auto', 'video', 'presign'],
    ['auto', 'audio', 'upload'],
    ['auto', 'image', 'upload'],
    ['metadataInspect', 'pdf', 'metadataInspect'],
  ];
  it.each(cases)('%s + %s -> %s', (endpoint, kind, expected) => {
    expect(resolveTransport({ endpoint }, kind)).toBe(expected);
  });
});
