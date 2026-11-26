/**
 * Test helper (MA62): the bundled font set as file names (the app's `bundledFonts.ts` maps the same
 * families and weights to `require` ids), read from `assets/fonts/studio/manifest.json`.
 */
import type { BundledFonts } from '../fonts';
import { FONT_MANIFEST } from './canvas2d';

export const BUNDLED_FONTS_FILES: BundledFonts = (() => {
  const out: BundledFonts = {};
  for (const f of FONT_MANIFEST.files) (out[f.family] ??= {})[f.weight] = f.file;
  return out;
})();
