import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolContext } from '../../types';
import * as b from '../image';
import { imageConversionSchema } from '../imageSchema';
import { pdfConversionSchema } from '../pdfSchema';

const DIR = join(__dirname, '..', '__golden__');
const ctx = (extension: string): ToolContext => ({
  input: { name: `a.${extension}`, extension, mime: '', mediaKind: 'image' },
});

/** Compares to `__golden__/<name>.json`; `UPDATE_GOLDEN=1` (re)writes it. */
function golden(name: string, value: unknown, schema: 'image' | 'pdf' | null = 'image') {
  if (schema === 'image') expect(imageConversionSchema.safeParse(value).success).toBe(true);
  if (schema === 'pdf') expect(pdfConversionSchema.safeParse(value).success).toBe(true);
  const file = join(DIR, `${name}.json`);
  if (process.env.UPDATE_GOLDEN === '1') {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  }
  expect(existsSync(file)).toBe(true);
  expect(value).toEqual(JSON.parse(readFileSync(file, 'utf8')));
}

describe('image option builders (golden)', () => {
  it('image-convert.default', () =>
    golden('image-convert.default', b.buildImageConvertOptions(b.convertDefaults)));
  it('image-convert.ico-subset', () =>
    golden(
      'image-convert.ico-subset',
      b.buildImageConvertOptions({ format: 'ico', quality: 85, icoSizes: [32, 16] }),
    ));
  it('image-convert.png-no-quality-field-change', () => {
    const o = b.buildImageConvertOptions({ ...b.convertDefaults, format: 'png' });
    expect(o.quality).toBe(85);
    golden('image-convert.png-no-quality-field-change', o);
  });
  it('ico with all six sizes omits the ico block', () => {
    const o = b.buildImageConvertOptions({ ...b.convertDefaults, format: 'ico' });
    expect(o).not.toHaveProperty('ico');
  });
  it('image-to-svg.default', () =>
    golden('image-to-svg.default', b.buildImageToSvgOptions(b.svgDefaults)));
  it('image-resize.width-only', () =>
    golden(
      'image-resize.width-only',
      b.buildImageResizeOptions({ ...b.resizeDefaults, width: 1080, height: 700 }, ctx('png')),
    ));
  it('image-resize.exact-both', () =>
    golden(
      'image-resize.exact-both',
      b.buildImageResizeOptions(
        { width: 800, height: 600, keepAspect: false, lastEdited: 'height', format: 'same' },
        ctx('webp'),
      ),
    ));
  it('image-resize keep-aspect with height last edited sends height only', () => {
    const o = b.buildImageResizeOptions(
      { width: 800, height: 600, keepAspect: true, lastEdited: 'height', format: 'same' },
      ctx('jpg'),
    );
    expect(o.height).toBe(600);
    expect(o).not.toHaveProperty('width');
  });
  it('image-compress.webp-60', () =>
    golden('image-compress.webp-60', b.buildImageCompressOptions({ format: 'webp', quality: 60 })));
  it('image-compress same resolves webp or jpg', () => {
    expect(b.buildImageCompressOptions(b.compressDefaults, ctx('webp')).format).toBe('webp');
    expect(b.buildImageCompressOptions(b.compressDefaults, ctx('png')).format).toBe('jpg');
    expect(b.buildImageCompressOptions(b.compressDefaults, ctx('png')).quality).toBe(80);
  });
  it('image-crop.rect', () =>
    golden(
      'image-crop.rect',
      b.buildImageCropOptions(
        { rect: { x: 10.4, y: 20, width: 300, height: 200.6 }, aspect: 'free', format: 'same' },
        ctx('jpeg'),
      ),
    ));
  it('image-filter.oil-painting', () =>
    golden(
      'image-filter.oil-painting',
      b.buildImageFilterOptions({ filter: 'oil-painting', format: 'same' }, ctx('jpg')),
    ));
  it('image-rotate.270 uses U+00BA', () => {
    const o = b.buildImageRotateOptions({ rotation: 'ccw90', format: 'same' }, ctx('png'));
    expect(o.filter).toBe('rotate-270º');
    expect(o.filter!.codePointAt(o.filter!.length - 1)).toBe(0xba);
    expect(o.filter).not.toContain('°');
    golden('image-rotate.270', o);
  });
  it('image-rotate maps all three', () => {
    const f = (r: b.Rotation) => b.buildImageRotateOptions({ rotation: r, format: 'same' }).filter;
    expect([f('cw90'), f('r180'), f('ccw90')]).toEqual([
      'rotate-90º',
      'rotate-180º',
      'rotate-270º',
    ]);
  });
  it('image-text.full', () =>
    golden(
      'image-text.full',
      b.buildImageTextOptions(
        {
          text: 'Hello',
          size: 96,
          color: '#FF6B4A',
          strokeColor: '#000000',
          strokeWidth: 4,
          gravity: 'South',
          font: 'DejaVu-Sans-Mono',
          x: 0,
          y: 12,
          format: 'png',
        },
        ctx('jpg'),
      ),
    ));
  it('image-to-pdf.default', () => golden('image-to-pdf.default', b.buildImageToPdfOptions()));
  it('pdf-to-image.all-150', () =>
    golden('pdf-to-image.all-150', b.buildPdfToImageOptions(b.pdfToImageDefaults), 'pdf'));
  it('pdf-to-image.first-png (no quality)', () => {
    const o = b.buildPdfToImageOptions({
      ...b.pdfToImageDefaults,
      format: 'png',
      pageSelection: 'first',
    });
    expect(o).not.toHaveProperty('quality');
    golden('pdf-to-image.first-png', o, 'pdf');
  });
  it('format-rule.heic-to-jpg', () => {
    const o = b.buildImageFilterOptions({ filter: 'sepia', format: 'same' }, ctx('heic'));
    expect(o.format).toBe('jpg');
    golden('format-rule.heic-to-jpg', o);
    for (const [ext, want] of [
      ['jpeg', 'jpg'],
      ['PNG', 'png'],
      ['webp', 'webp'],
      ['gif', 'gif'],
      ['avif', 'avif'],
      ['tiff', 'jpg'],
      ['bmp', 'jpg'],
      ['svg', 'jpg'],
      [undefined, 'jpg'],
    ] as const)
      expect(b.sameAsOriginalFormat(ext)).toBe(want);
  });
  it('every image builder sends quality and filter', () => {
    const outs = [
      b.buildImageConvertOptions(b.convertDefaults),
      b.buildImageToSvgOptions(b.svgDefaults),
      b.buildImageResizeOptions(b.resizeDefaults),
      b.buildImageCompressOptions(b.compressDefaults),
      b.buildImageCropOptions(b.cropDefaults),
      b.buildImageFilterOptions(b.filterDefaults),
      b.buildImageRotateOptions(b.rotateDefaults),
      b.buildImageTextOptions({ ...b.textDefaults, text: 'x' }),
      b.buildImageToPdfOptions(),
    ];
    for (const o of outs) {
      expect(o.quality).toBeGreaterThanOrEqual(1);
      expect(o.filter).toBeDefined();
      for (const k of ['metadataMode', 'metadata', 'gpsOptions', 'advancedTags', 'ai'])
        expect(o).not.toHaveProperty(k);
    }
  });
  it('block reasons', () => {
    const limits = { maxOutputHeight: 1440 };
    const h = (height?: number, width?: number, keep = true, last: 'width' | 'height' = 'height') =>
      b.resizeBlockReason(
        { width, height, keepAspect: keep, lastEdited: last, format: 'same' },
        { ...ctx('jpg'), limits },
      );
    expect(h(2000)).toBe('output_height');
    expect(h(1440)).toBeNull();
    expect(h(2000, 3000, true, 'width')).toBeNull();
    expect(h(2000, 3000, false)).toBe('output_height');
    expect(h(undefined, undefined)).toBe('size_required');
    expect(b.textBlockReason(b.textDefaults)).toBe('text_required');
    expect(b.cropBlockReason(b.cropDefaults)).toBe('crop_required');
  });
});
