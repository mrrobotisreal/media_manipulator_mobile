import { TOOL_BY_ID, toolsByFamily } from '../registry';
import { IMAGE_ACCEPTS } from '../families/shared';

const SLUGS: Record<string, string> = {
  'image-convert': 'image-converter',
  'image-to-svg': 'convert-png-to-svg',
  'image-resize': 'image-resizer',
  'image-compress': 'compress-image',
  'image-crop': 'crop-image',
  'image-filter': 'image-filters',
  'image-rotate': 'rotate-image',
  'image-text': 'add-text-to-image',
  'image-to-pdf': 'image-to-pdf',
  'pdf-to-image': 'pdf-to-jpg',
};

describe('image family registry rows', () => {
  it('has the ten ids with ops metric, upload endpoint and the analytics slug', () => {
    expect(
      toolsByFamily('image')
        .map((t) => t.id)
        .sort(),
    ).toEqual(Object.keys(SLUGS).sort());
    for (const [id, slug] of Object.entries(SLUGS)) {
      const t = TOOL_BY_ID.get(id)!;
      expect(t.metric).toBe('ops');
      expect(t.endpoint).toBe('upload');
      expect(t.analyticsSlug).toBe(slug);
      expect(t.gpu).toBe(false);
      expect(t.minTier).toBeUndefined();
    }
  });

  it('every row builds options from its own defaults without a context', () => {
    for (const id of Object.keys(SLUGS)) {
      const t = TOOL_BY_ID.get(id)!;
      const o = t.optionsBuilder(t.defaults);
      expect(o.format).toBeDefined();
      if (id !== 'pdf-to-image') {
        expect(o.quality).toBeGreaterThanOrEqual(1);
        expect(o.filter).toBeDefined();
      }
    }
  });

  it('pdf-to-image accepts only PDFs; the rest accept the image set', () => {
    expect(TOOL_BY_ID.get('pdf-to-image')!.accepts.kinds).toEqual(['pdf']);
    for (const id of Object.keys(SLUGS).filter((x) => x !== 'pdf-to-image'))
      expect(TOOL_BY_ID.get(id)!.accepts).toEqual(IMAGE_ACCEPTS);
  });

  it('folded slugs are presets of their host row', () => {
    const filter = TOOL_BY_ID.get('image-filter')!;
    expect(filter.presets!.map((p) => [p.analyticsSlug, p.defaults.filter])).toEqual([
      ['grayscale-image', 'grayscale'],
      ['sharpen-image', 'sharpen'],
      ['blur-image', 'blur'],
    ]);
    expect(TOOL_BY_ID.get('image-convert')!.presets![0]!.defaults).toEqual({ format: 'ico' });
    expect(TOOL_BY_ID.get('pdf-to-image')!.presets![0]!.defaults).toEqual({ format: 'png' });
  });

  it('gated rows expose blockReason', () => {
    for (const id of ['image-resize', 'image-crop', 'image-text'])
      expect(TOOL_BY_ID.get(id)!.blockReason).toBeInstanceOf(Function);
  });
});
