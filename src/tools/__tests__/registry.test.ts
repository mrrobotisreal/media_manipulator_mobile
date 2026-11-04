import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  WEB_AI_UPLOAD_OPERATIONS,
  WEB_TOOL_ALIASES,
  WEB_PHOTO_SLUGS,
  WEB_TOOL_SLUGS,
} from '../__fixtures__/webTools';
import { AI_OPS_UPLOAD_OPERATIONS, quotaMetricForJob } from '../metric';
import { TOOLS, TOOL_BY_ID, toolsAccepting, toolsByFamily } from '../registry';

const EXPECTED_IDS = [
  'image-convert',
  'image-to-svg',
  'image-resize',
  'image-compress',
  'image-crop',
  'image-filter',
  'image-rotate',
  'image-text',
  'image-to-pdf',
  'pdf-to-image',
  'video-convert',
  'video-compress',
  'video-trim',
  'video-to-gif',
  'video-extract-audio',
  'video-remove-audio',
  'video-extract-frames',
  'video-transform',
  'video-speed',
  'video-adjust',
  'audio-convert',
  'audio-trim',
  'audio-effects',
  'audio-waveform',
  'remove-background',
  'upscale',
  'blur-faces',
  'redact-text',
  'remove-object',
  'clean-voice',
  'remove-noise',
  'isolate-vocals',
  'remove-vocals',
  'frame-interpolation',
  'transcribe',
  'inspect-metadata',
  'strip-metadata',
  'edit-metadata',
  // MA50
  'aperture',
  // MA52: the MM100 pages as entry rows
  'aperture-brighten',
  'aperture-contrast',
  'aperture-exposure',
  'aperture-hue',
  'aperture-color-pop',
  'aperture-black-white',
  'aperture-curves',
  'aperture-levels',
  'aperture-white-balance',
  'aperture-straighten',
  'aperture-perspective',
  'aperture-blemishes',
  'aperture-select-color',
  'aperture-sharpen',
  'aperture-noise',
  'aperture-vignette',
];

const en = JSON.parse(readFileSync(join(__dirname, '../../../locales/en-us/app.json'), 'utf8'));
const lookup = (key: string): unknown => key.split('.').reduce((o: any, k) => o?.[k], en);

describe('tool registry invariants', () => {
  it('has exactly the 38 v1 ids plus aperture (MA50) and its 16 entry rows (MA52) with unique kebab-case ids', () => {
    expect(TOOLS.map((t) => t.id).sort()).toEqual([...EXPECTED_IDS].sort());
    expect(new Set(TOOLS.map((t) => t.id)).size).toBe(55);
    for (const t of TOOLS) expect(t.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(TOOL_BY_ID.size).toBe(55);
  });

  it('family sizes are 27/10/4/11/3', () => {
    expect(
      (['image', 'video', 'audio', 'ai', 'metadata'] as const).map((f) => toolsByFamily(f).length),
    ).toEqual([27, 10, 4, 11, 3]);
  });

  it('every title/description key exists in en-US app.json', () => {
    for (const t of TOOLS) {
      expect(typeof lookup(t.titleKey)).toBe('string');
      expect(typeof lookup(t.descriptionKey)).toBe('string');
    }
  });

  it('analytics slugs are real web slugs and never aliases', () => {
    const slugs = [...WEB_TOOL_SLUGS, ...WEB_PHOTO_SLUGS];
    for (const t of TOOLS) {
      expect(slugs).toContain(t.analyticsSlug);
      expect(WEB_TOOL_ALIASES).not.toContain(t.analyticsSlug);
      for (const p of t.presets ?? []) {
        expect(slugs).toContain(p.analyticsSlug);
        expect(WEB_TOOL_ALIASES).not.toContain(p.analyticsSlug);
      }
    }
    expect(WEB_TOOL_SLUGS).toHaveLength(112);
    expect(WEB_TOOL_ALIASES).toHaveLength(14);
  });

  it('keeps the AI upload operation set identical to the web/API', () => {
    expect([...AI_OPS_UPLOAD_OPERATIONS].sort()).toEqual([...WEB_AI_UPLOAD_OPERATIONS].sort());
  });

  it('QuotaMetricForJob port over the default options equals the row metric', () => {
    for (const t of TOOLS) {
      const metric = quotaMetricForJob(t.optionsBuilder(t.defaults));
      if (t.id === 'inspect-metadata') expect(t.metric).toBeNull();
      else expect(metric).toBe(t.metric);
    }
  });

  it('video family rows presign; auto rows are the U/P tools', () => {
    for (const t of toolsByFamily('video')) expect(t.endpoint).toBe('presign');
    expect(
      TOOLS.filter((t) => t.endpoint === 'auto')
        .map((t) => t.id)
        .sort(),
    ).toEqual(['isolate-vocals', 'remove-vocals', 'transcribe']);
  });

  it('accepts are non-empty, lower-case and dotless', () => {
    for (const t of TOOLS) {
      expect(t.accepts.kinds.length).toBeGreaterThan(0);
      expect(t.accepts.extensions.length).toBeGreaterThan(0);
      for (const e of t.accepts.extensions) expect(e).toMatch(/^[a-z0-9]+$/);
    }
  });

  it('video rows list exactly the API presign extensions', () => {
    for (const t of toolsByFamily('video'))
      expect([...t.accepts.extensions].sort()).toEqual(
        ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'flv', 'wmv', 'mpeg', 'mpg'].sort(),
      );
  });

  it('gpu is true exactly for AI-family rows (MA20 decision 1)', () => {
    for (const t of TOOLS) expect(t.gpu).toBe(t.family === 'ai');
  });

  it('toolsAccepting(pdf) is pdf-to-image and inspect-metadata', () => {
    expect(
      toolsAccepting('pdf')
        .map((t) => t.id)
        .sort(),
    ).toEqual(['inspect-metadata', 'pdf-to-image']);
  });

  it('identity builders carry the API-required keys', () => {
    // aperture (MA50) never builds /upload options: it opens the editor (endpoint photoProject).
    for (const t of toolsByFamily('image')
      .concat(toolsByFamily('metadata'))
      .filter(
        (x) =>
          x.id !== 'inspect-metadata' && x.id !== 'pdf-to-image' && x.endpoint !== 'photoProject',
      )) {
      const o = t.optionsBuilder(t.defaults);
      expect(o.format).toBeDefined();
      expect(o.quality).toBeGreaterThanOrEqual(1);
      expect(o.filter).toBeDefined();
    }
    for (const id of ['video-convert', 'video-to-gif', 'frame-interpolation']) {
      const o = TOOL_BY_ID.get(id)!.optionsBuilder(TOOL_BY_ID.get(id)!.defaults);
      expect(o).toMatchObject({ preserveAspectRatio: true, quality: 'medium' });
    }
    expect(
      TOOL_BY_ID.get('transcribe')!.optionsBuilder({ mode: 'transcribe', format: 'vtt' }),
    ).toEqual({ mode: 'transcribe', format: 'vtt' });
    expect(TOOL_BY_ID.get('strip-metadata')!.defaults).toMatchObject({ metadataMode: 'strip' });
  });
});
