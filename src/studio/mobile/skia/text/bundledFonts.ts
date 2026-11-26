/**
 * The bundled Darkroom font files (MA62 decision 8): ordinary JS assets, one `require` per file, so
 * they reach phones by OTA (nothing in `app.config.ts`, no expo-font plugin). The set and its
 * licence routes are `assets/fonts/studio/manifest.json` (`scripts/import-studio-fonts.py`);
 * `__tests__/fonts.test.ts` checks this map against it and against the copied `titleFonts.ts`.
 */
import type { BundledFonts } from './fonts';

export const BUNDLED_FONTS: BundledFonts = {
  Inter: {
    400: require('../../../../../assets/fonts/studio/inter-400.ttf'),
    700: require('../../../../../assets/fonts/studio/inter-700.ttf'),
  },
  'Noto Sans': {
    400: require('../../../../../assets/fonts/studio/noto-sans-400.ttf'),
    700: require('../../../../../assets/fonts/studio/noto-sans-700.ttf'),
  },
  'Open Sans': {
    400: require('../../../../../assets/fonts/studio/open-sans-400.ttf'),
    700: require('../../../../../assets/fonts/studio/open-sans-700.ttf'),
  },
  Montserrat: {
    400: require('../../../../../assets/fonts/studio/montserrat-400.ttf'),
    700: require('../../../../../assets/fonts/studio/montserrat-700.ttf'),
  },
  Poppins: {
    400: require('../../../../../assets/fonts/studio/poppins-400.ttf'),
    700: require('../../../../../assets/fonts/studio/poppins-700.ttf'),
  },
  Raleway: {
    400: require('../../../../../assets/fonts/studio/raleway-400.ttf'),
    700: require('../../../../../assets/fonts/studio/raleway-700.ttf'),
  },
  Oswald: {
    400: require('../../../../../assets/fonts/studio/oswald-400.ttf'),
    700: require('../../../../../assets/fonts/studio/oswald-700.ttf'),
  },
  'Bebas Neue': { 400: require('../../../../../assets/fonts/studio/bebas-neue-400.ttf') },
  Anton: { 400: require('../../../../../assets/fonts/studio/anton-400.ttf') },
  'Playfair Display': {
    400: require('../../../../../assets/fonts/studio/playfair-display-400.ttf'),
    700: require('../../../../../assets/fonts/studio/playfair-display-700.ttf'),
  },
  Merriweather: {
    400: require('../../../../../assets/fonts/studio/merriweather-400.ttf'),
    700: require('../../../../../assets/fonts/studio/merriweather-700.ttf'),
  },
  Lora: {
    400: require('../../../../../assets/fonts/studio/lora-400.ttf'),
    700: require('../../../../../assets/fonts/studio/lora-700.ttf'),
  },
  'JetBrains Mono': {
    400: require('../../../../../assets/fonts/studio/jetbrains-mono-400.ttf'),
    700: require('../../../../../assets/fonts/studio/jetbrains-mono-700.ttf'),
  },
  'Space Mono': {
    400: require('../../../../../assets/fonts/studio/space-mono-400.ttf'),
    700: require('../../../../../assets/fonts/studio/space-mono-700.ttf'),
  },
  'Dancing Script': {
    400: require('../../../../../assets/fonts/studio/dancing-script-400.ttf'),
    700: require('../../../../../assets/fonts/studio/dancing-script-700.ttf'),
  },
  Pacifico: { 400: require('../../../../../assets/fonts/studio/pacifico-400.ttf') },
  // Caption display families (captionsCatalog.json).
  Bangers: { 400: require('../../../../../assets/fonts/studio/bangers-400.ttf') },
  'Titan One': { 400: require('../../../../../assets/fonts/studio/titan-one-400.ttf') },
  'Lilita One': { 400: require('../../../../../assets/fonts/studio/lilita-one-400.ttf') },
  'Bowlby One': { 400: require('../../../../../assets/fonts/studio/bowlby-one-400.ttf') },
  'Rubik Mono One': { 400: require('../../../../../assets/fonts/studio/rubik-mono-one-400.ttf') },
  'Russo One': { 400: require('../../../../../assets/fonts/studio/russo-one-400.ttf') },
};
