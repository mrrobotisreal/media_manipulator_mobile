/**
 * MA50 parity (ticket decision 2, acceptance 2): the copied `PhotoDoc` schema and the copied
 * `colorMath.ts` reference reproduce the web's committed fixtures and goldens byte for byte, so the
 * formulas are pinned on the phone with no GPU. The fixtures, goldens and sources are copies made by
 * `scripts/sync-photo-fixtures.mjs` (its `--check` is a gate).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { docFixtures, inputFixtures, invalidFixtures, readFixture } from '../fixtures/fixtures';
import {
  GOLDEN_ASSETS,
  GOLDEN_IMAGES,
  goldenDocs,
  goldenPath,
  readImage,
  renderGolden,
} from '../goldens';
import { renderDocCPU, toBytes } from '../colorMath';
import { canonicalPhotoDoc, parsePhotoDoc } from '../photoTypes';

const INPUT_TO_DOC: Record<string, string> = {
  'minimal.json': 'blank.json',
  'defaults.json': 'defaults.json',
  'clamp.json': 'clamped.json',
};

const decode = (buf: Buffer) => PNG.sync.read(buf);

describe('PhotoDoc fixtures (shared contract with the web Zod model and the Go sanitizer)', () => {
  it('copies every shared fixture', () => {
    expect(docFixtures().length).toBeGreaterThanOrEqual(16);
    expect(invalidFixtures()).toHaveLength(4);
    expect(inputFixtures()).toEqual(Object.keys(INPUT_TO_DOC).sort());
  });

  it.each(docFixtures())('%s parses and canonicalises to the committed bytes', (f) => {
    const text = readFixture('docs', f);
    const r = parsePhotoDoc(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(`${canonicalPhotoDoc(r.doc)}\n`).toBe(text);
    const again = parsePhotoDoc(canonicalPhotoDoc(r.doc));
    expect(again.ok && canonicalPhotoDoc(again.doc)).toBe(canonicalPhotoDoc(r.doc));
  });

  it.each(invalidFixtures())('%s is refused', (f) => {
    expect(parsePhotoDoc(readFixture('docs', f)).ok).toBe(false);
  });

  it.each(inputFixtures())('input %s canonicalises to its fixture', (f) => {
    const r = parsePhotoDoc(readFixture('inputs', f));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(`${canonicalPhotoDoc(r.doc)}\n`).toBe(readFixture('docs', INPUT_TO_DOC[f]!));
  });

  it('the doc shape the API and web added after the ticket (heals[].baseRef, doc.masks, layer.mask {ref}, layer.group) round-trips', () => {
    for (const f of ['heal-base-refs.json', 'masks-named.json', 'layer-groups.json']) {
      const text = readFixture('docs', f);
      const r = parsePhotoDoc(text);
      expect([f, r.ok]).toEqual([f, true]);
      if (r.ok) expect(`${canonicalPhotoDoc(r.doc)}\n`).toBe(text);
    }
  });
});

describe('goldens (copied colorMath reference == committed PNGs)', () => {
  const docs = goldenDocs();

  it('covers the shared and per-type docs over three images', () => {
    expect(docs.length).toBeGreaterThanOrEqual(24);
    expect(GOLDEN_IMAGES).toEqual(['photo', 'chart', 'alpha']);
  });

  it.each(['rung1-all-layers', 'hsl-grey-except-red'])(
    'renderDocCPU(%s) equals the goldens byte for byte on all three fixture images',
    (name) => {
      const r = parsePhotoDoc(readFixture('docs', `${name}.json`));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      for (const image of GOLDEN_IMAGES) {
        const bytes = toBytes(renderDocCPU(r.doc, readImage(image), GOLDEN_ASSETS));
        const golden = decode(readFileSync(goldenPath(name, image)));
        expect([image, Buffer.compare(Buffer.from(bytes), golden.data)]).toEqual([image, 0]);
      }
    },
  );

  // Every golden the web commits (rung 1 through masks, geometry and detail): the whole copied
  // reference, not only the two docs the ticket names.
  it.each(docs.map((d) => [d.name, d] as const))('golden equality: %s', (_name, { name, doc }) => {
    for (const image of GOLDEN_IMAGES) {
      const fresh = decode(renderGolden(doc, image));
      const committed = decode(readFileSync(goldenPath(name, image)));
      expect([fresh.width, fresh.height]).toEqual([committed.width, committed.height]);
      expect([`${name}.${image}`, Buffer.compare(fresh.data, committed.data)]).toEqual([
        `${name}.${image}`,
        0,
      ]);
    }
  });

  it('the copied built-in presets parse as layer lists', () => {
    const dir = join(__dirname, '..', 'presets', 'builtin');
    const files = readdirSync(dir);
    expect(files.length).toBeGreaterThanOrEqual(18);
    for (const f of files) {
      const preset = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { layers?: unknown[] };
      const r = parsePhotoDoc({
        version: 1,
        source: { width: 1, height: 1 },
        layers: preset.layers ?? [],
      });
      expect([f, r.ok]).toEqual([f, true]);
    }
  });
});
