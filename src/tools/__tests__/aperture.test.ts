import { TOOL_BY_ID, toolsByFamily } from '../registry';
import { isToolAvailable } from '../availability';
import { resolveTransport } from '../resolveTransport';
import { describe as describeResult } from '@/results/describe';
import { toolLabel } from '@/history/toolLabel';

describe('aperture registry row (MA50 decision 9)', () => {
  const row = TOOL_BY_ID.get('aperture')!;

  it('is an image-family photo-project row that runs itself', () => {
    expect(row).toMatchObject({
      family: 'image',
      icon: 'SlidersHorizontal',
      endpoint: 'photoProject',
      metric: 'ops',
      gpu: false,
      analyticsSlug: 'aperture',
      webTask: 'aperture',
      resultHint: 'image',
      noRunButton: true,
      capability: 'photo',
      titleKey: 'tools.items.aperture.title',
    });
    expect(toolsByFamily('image').map((t) => t.id)).toContain('aperture');
    expect(resolveTransport(row, 'image')).toBe('photoProject');
  });

  it('accepts the API photo source set: heic, heif, tiff, bmp; never svg or ico', () => {
    for (const e of ['jpg', 'png', 'webp', 'heic', 'heif', 'tif', 'tiff', 'bmp', 'avif', 'gif'])
      expect(row.accepts.extensions).toContain(e);
    expect(row.accepts.extensions).not.toContain('svg');
    expect(row.accepts.extensions).not.toContain('ico');
  });

  it('is found by MM100 slugs', () => {
    expect(row.keywords).toEqual(
      expect.arrayContaining(['color', 'pop', 'curves', 'brighten', 'photo']),
    );
  });

  it('is hidden when capabilities say render: false or enabled: false; shown while unknown', () => {
    expect(isToolAvailable(row, { photo: { enabled: true, render: false } })).toBe(false);
    expect(isToolAvailable(row, { photo: { enabled: false, render: true } })).toBe(false);
    expect(isToolAvailable(row, { photo: { enabled: true, render: true } })).toBe(true);
    expect(isToolAvailable(row, {})).toBe(true);
    expect(
      isToolAvailable(TOOL_BY_ID.get('image-convert')!, {
        photo: { enabled: false, render: false },
      }),
    ).toBe(true);
  });

  it('a photo_export job describes as an image result and History labels it "Aperture export" (MA52)', () => {
    const d = describeResult({
      job: { id: 'j1' },
      task: 'photo_export',
    });
    expect(d.kind).toBe('image');
    expect(toolLabel({ tool: 'photo_export', mode: 'jpg', mediaKind: 'image' })).toEqual({
      toolId: 'aperture',
      key: 'history.tool.photo_export',
    });
  });
});
