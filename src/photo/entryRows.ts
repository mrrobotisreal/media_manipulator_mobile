/**
 * Aperture entry rows (ticket MA52 decision 1): the web's MM100 tool pages as Tools-tab rows. Each
 * row opens the editor with one sheet in front (the app's strip ids: `color` is the web's `hsl`,
 * `bw` its `blackWhite`) and, for colour pop and black & white, the page's built-in look applied.
 * `slug` is the web page slug (`content/photo/index.ts` `PHOTO_PAGE_WIRING`), reported as
 * `context.tool_slug` so the web and app funnels compare. Pure data, tested.
 */
import type { StripTool } from './ui/stripTools';

export interface AperturePresetRow {
  /** Registry id (`aperture-<short>`). */
  id: string;
  /** The `tools.aperture.<short>` i18n block. */
  short: string;
  /** MM100 web page slug = `analyticsSlug`. */
  slug: string;
  panel: StripTool;
  /** A built-in look applied on open (`src/photo/presets/builtin`). */
  preset?: string;
  /** lucide icon name (`src/tools/icons.tsx`). */
  icon: string;
  /** Extra English search words (the slug's words are added by the registry). */
  keywords: string[];
}

const r = (
  short: string,
  slug: string,
  panel: StripTool,
  icon: string,
  keywords: string[] = [],
  preset?: string,
): AperturePresetRow => ({
  id: `aperture-${short}`,
  short,
  slug,
  panel,
  icon,
  keywords,
  ...(preset ? { preset } : {}),
});

export const APERTURE_PRESET_ROWS: readonly AperturePresetRow[] = [
  r('brighten', 'brighten-image', 'basic', 'Sun', ['brightness', 'lighten', 'dark', 'shadows']),
  r('contrast', 'adjust-image-contrast', 'basic', 'Contrast', ['flat', 'punchy']),
  r('exposure', 'fix-photo-exposure', 'basic', 'SunMedium', ['ev', 'overexposed', 'underexposed']),
  r('hue', 'adjust-image-hue', 'color', 'Palette', ['hsl', 'colour', 'shift']),
  r(
    'color-pop',
    'color-pop',
    'color',
    'Droplet',
    ['colour', 'splash', 'grey', 'gray'],
    'color-pop-red',
  ),
  r(
    'black-white',
    'black-and-white-photo',
    'bw',
    'Aperture',
    ['monochrome', 'grayscale', 'greyscale', 'mono', 'film'],
    'bw-film',
  ),
  r('curves', 'photo-curves', 'curves', 'Spline', ['tone', 'rgb']),
  r('levels', 'photo-levels', 'levels', 'ChartColumn', ['histogram', 'black', 'white', 'point']),
  r('white-balance', 'white-balance-photo', 'basic', 'Thermometer', [
    'temperature',
    'tint',
    'cast',
    'warm',
    'cool',
  ]),
  r('straighten', 'straighten-photo', 'geometry', 'Ruler', ['rotate', 'horizon', 'tilt', 'level']),
  r('perspective', 'fix-perspective-photo', 'geometry', 'Grid3x3', [
    'keystone',
    'skew',
    'distortion',
  ]),
  r('blemishes', 'remove-blemishes', 'heal', 'Bandage', ['heal', 'spots', 'acne', 'retouch']),
  r('select-color', 'select-by-color', 'masks', 'Pipette', [
    'mask',
    'colour',
    'range',
    'eyedropper',
  ]),
  r('sharpen', 'sharpen-photo-online', 'detail', 'Focus', [
    'sharp',
    'unsharp',
    'clarity',
    'blurry',
  ]),
  r('noise', 'reduce-image-noise', 'detail', 'Sparkles', ['denoise', 'grain', 'iso']),
  r('vignette', 'add-vignette', 'detail', 'Scan', ['edges', 'corners', 'darken']),
];
