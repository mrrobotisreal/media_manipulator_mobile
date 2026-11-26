/**
 * @jest-environment node
 *
 * The bundled Darkroom fonts (MA62 decision 8): the files match the manifest the import script
 * wrote (sizes, SHA-256), the app's `require` map names exactly those files, every family of the
 * copied web registry (`titleFonts.ts`) and the caption display families are covered (DejaVu Sans by
 * download), reserved-font-name families are byte copies, and the loader's behaviour (fallback,
 * offline retry, version bump, disposal).
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import catalog from '../../../../captions/captionsCatalog.json';
import { STUDIO_TITLE_FONTS } from '../../../../titleFonts';
import { loadSkiaApi } from '../../../../../photo/skia/testing/skiaTestApi';
import { createStudioFonts, DOWNLOADED, projectFamilies } from '../fonts';
import { BUNDLED_FONTS_FILES } from '../testing/bundledFiles';
import { fontBytes } from '../testing/canvas2d';

const DIR = join(__dirname, '..', '..', '..', '..', '..', '..', 'assets', 'fonts', 'studio');
const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as {
  files: {
    file: string;
    family: string;
    weight: number;
    bytes: number;
    sha256: string;
    reservedFontName: boolean;
    route: string;
  }[];
  totalBytes: number;
};

describe('assets/fonts/studio', () => {
  it('every file is in the manifest with its size and hash, and nothing else is there', () => {
    const onDisk = readdirSync(DIR)
      .filter((f) => f.endsWith('.ttf'))
      .sort();
    expect(manifest.files.map((f) => f.file).sort()).toEqual(onDisk);
    for (const f of manifest.files) {
      const b = readFileSync(join(DIR, f.file));
      expect([f.file, b.length, createHash('sha256').update(b).digest('hex')]).toEqual([
        f.file,
        f.bytes,
        f.sha256,
      ]);
    }
    expect(manifest.totalBytes).toBe(manifest.files.reduce((n, f) => n + f.bytes, 0));
    expect(readdirSync(DIR)).toContain('OFL.txt');
  });

  it('reserved-font-name families are unmodified copies (OFL 1.1 clause 3)', () => {
    const rfn = manifest.files.filter((x) => x.reservedFontName);
    expect(rfn.length).toBeGreaterThan(0);
    for (const f of rfn)
      expect([f.file, f.route.startsWith('copied unmodified')]).toEqual([f.file, true]);
  });

  it('the app require map names the same families and weights as the manifest', () => {
    // bundledFonts.ts holds one require per manifest file: compare its text with the manifest.
    const src = readFileSync(join(__dirname, '..', 'bundledFonts.ts'), 'utf8');
    const required = [...src.matchAll(/assets\/fonts\/studio\/([a-z0-9-]+\.ttf)/g)]
      .map((m) => m[1])
      .sort();
    expect(required).toEqual(manifest.files.map((f) => f.file).sort());
  });

  it('covers the web title registry and the caption display families (DejaVu by download)', () => {
    const bundled = Object.keys(BUNDLED_FONTS_FILES);
    for (const f of STUDIO_TITLE_FONTS) {
      const weights = f.supportsBold ? [400, 700] : [400];
      if (f.family === 'DejaVu Sans') {
        expect(Object.keys(DOWNLOADED['DejaVu Sans']!).map(Number)).toEqual(weights);
        continue;
      }
      expect([f.family, Object.keys(BUNDLED_FONTS_FILES[f.family] ?? {}).map(Number)]).toEqual([
        f.family,
        weights,
      ]);
    }
    const display = (catalog.fonts as { family: string; script?: string }[])
      .map((f) => f.family)
      .filter(
        (f) =>
          !STUDIO_TITLE_FONTS.some((t) => t.family === f) && !catalog.fallbackFonts.includes(f),
      );
    for (const f of display) expect([f, bundled.includes(f)]).toEqual([f, true]);
  });
});

describe('createStudioFonts', () => {
  it('loads bundled families, falls back while a download is missing, retries, bumps the version, disposes', async () => {
    const api = await loadSkiaApi();
    let online = false;
    const fonts = createStudioFonts({
      api,
      bundled: BUNDLED_FONTS_FILES,
      loadBundled: async (file) => {
        const b = fontBytes(String(file));
        return api.Data.fromBytes(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
      },
      loadDownloaded: async () => {
        if (!online) return null;
        // Stand-in bytes for the CDN's DejaVu (jest has no network): any valid TTF.
        const b = fontBytes('inter-400.ttf');
        return api.Data.fromBytes(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
      },
    });
    await fonts.ensure(['Montserrat', 'DejaVu Sans']);
    expect(fonts.has('Inter')).toBe(true);
    expect(fonts.has('Montserrat')).toBe(true);
    expect(fonts.has('DejaVu Sans')).toBe(false);
    const v = fonts.version;
    online = true;
    await fonts.ensure(['DejaVu Sans']);
    expect(fonts.has('DejaVu Sans')).toBe(true);
    expect(fonts.version).toBeGreaterThan(v);
    fonts.dispose();
    expect(fonts.has('Inter')).toBe(false);
  });

  it('projectFamilies: title layers + caption style (DejaVu when the style names none)', () => {
    const doc = {
      tracks: [
        {
          clips: [
            { title: { layers: [{ type: 'text', fontFamily: 'Lora' }, { type: 'rect' }] } },
            {},
          ],
        },
      ],
      captionStyle: null,
    };
    expect(projectFamilies(doc)).toEqual(['Inter', 'Lora', 'DejaVu Sans']);
    expect(projectFamilies({ ...doc, captionStyle: { fontFamily: 'Bangers' } })).toEqual([
      'Inter',
      'Lora',
      'Bangers',
    ]);
  });
});
