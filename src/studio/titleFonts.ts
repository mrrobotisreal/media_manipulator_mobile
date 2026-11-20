// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/titleFonts.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/**
 * Curated title-clip font registry (part 16). The single TS source of truth for
 * which families exist, which weights each ships, and how their files are
 * named — mirrored by the Go side (internal/services/studio_fonts.go for
 * drawtext file resolution, internal/models/studio_sanitize.go for the
 * family-name validity check). The full lockstep invariant + license table
 * lives in docs/content-studio/design/04-title-fonts.md at the workspace root.
 *
 * Files live under public/fonts/studio/ as `<stem>-<weight>.<ext>` and are
 * declared in components/content-studio/studio-fonts.css (editor routes only —
 * the marketing site never pays for them).
 */

export interface StudioTitleFont {
  /** Exact CSS family name AND the value stored in the EDL's fontFamily. */
  family: string;
  /** File stem under /fonts/studio/ (`<stem>-<weight>.woff2`). */
  stem: string;
  /** True when a 700 file exists. 400-only families clamp bold to 400 —
   * canvas synthetic bold would have no export equivalent. */
  supportsBold: boolean;
  /** Picker grouping label key suffix (sans/serif/display/mono/script). */
  category: 'sans' | 'serif' | 'display' | 'mono' | 'script';
  /** File extension of the shipped webfont (DejaVu has no woff2 build). */
  ext: 'woff2' | 'ttf';
}

export const DEFAULT_TITLE_FONT_FAMILY = 'Inter';

export const STUDIO_TITLE_FONTS: readonly StudioTitleFont[] = [
  { family: 'Inter', stem: 'inter', supportsBold: true, category: 'sans', ext: 'woff2' },
  { family: 'Noto Sans', stem: 'noto-sans', supportsBold: true, category: 'sans', ext: 'woff2' },
  { family: 'Open Sans', stem: 'open-sans', supportsBold: true, category: 'sans', ext: 'woff2' },
  { family: 'Montserrat', stem: 'montserrat', supportsBold: true, category: 'sans', ext: 'woff2' },
  { family: 'Poppins', stem: 'poppins', supportsBold: true, category: 'sans', ext: 'woff2' },
  { family: 'Raleway', stem: 'raleway', supportsBold: true, category: 'sans', ext: 'woff2' },
  { family: 'DejaVu Sans', stem: 'dejavu-sans', supportsBold: true, category: 'sans', ext: 'ttf' },
  { family: 'Oswald', stem: 'oswald', supportsBold: true, category: 'display', ext: 'woff2' },
  { family: 'Bebas Neue', stem: 'bebas-neue', supportsBold: false, category: 'display', ext: 'woff2' },
  { family: 'Anton', stem: 'anton', supportsBold: false, category: 'display', ext: 'woff2' },
  { family: 'Playfair Display', stem: 'playfair-display', supportsBold: true, category: 'serif', ext: 'woff2' },
  { family: 'Merriweather', stem: 'merriweather', supportsBold: true, category: 'serif', ext: 'woff2' },
  { family: 'Lora', stem: 'lora', supportsBold: true, category: 'serif', ext: 'woff2' },
  { family: 'JetBrains Mono', stem: 'jetbrains-mono', supportsBold: true, category: 'mono', ext: 'woff2' },
  { family: 'Space Mono', stem: 'space-mono', supportsBold: true, category: 'mono', ext: 'woff2' },
  { family: 'Dancing Script', stem: 'dancing-script', supportsBold: true, category: 'script', ext: 'woff2' },
  { family: 'Pacifico', stem: 'pacifico', supportsBold: false, category: 'script', ext: 'woff2' },
] as const;

const BY_FAMILY = new Map(STUDIO_TITLE_FONTS.map((f) => [f.family, f]));

export function titleFontByFamily(family: string): StudioTitleFont | undefined {
  return BY_FAMILY.get(family);
}

export function isKnownTitleFontFamily(family: string): boolean {
  return BY_FAMILY.has(family);
}

/**
 * Effective weight for a layer: unknown families resolve as the default
 * family; 400-only families clamp 700 → 400 so the canvas never synthesizes a
 * bold the export cannot reproduce.
 */
export function effectiveTitleFontWeight(family: string, requested: 400 | 700): 400 | 700 {
  const font = BY_FAMILY.get(family) ?? BY_FAMILY.get(DEFAULT_TITLE_FONT_FAMILY)!;
  return font.supportsBold ? requested : 400;
}

/** Sanitized family: known name kept, anything else → the default (mirrors Go). */
export function sanitizeTitleFontFamily(family: string): string {
  return BY_FAMILY.has(family) ? family : DEFAULT_TITLE_FONT_FAMILY;
}

// --- Loading ----------------------------------------------------------------

let loadPromise: Promise<void> | null = null;

/**
 * Resolves when every registry face is loaded (or failed — a missing face just
 * falls back and the raster proceeds; the alternative is never rendering).
 * The editor calls this before the first title raster to avoid a fallback
 * flash; the faces themselves come from studio-fonts.css on editor routes.
 */
export function ensureStudioFontsLoaded(): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return Promise.resolve();
  if (!loadPromise) {
    const loads: Promise<unknown>[] = [];
    for (const f of STUDIO_TITLE_FONTS) {
      loads.push(document.fonts.load(`400 16px "${f.family}"`));
      if (f.supportsBold) loads.push(document.fonts.load(`700 16px "${f.family}"`));
    }
    loadPromise = Promise.allSettled(loads).then(() => undefined);
  }
  return loadPromise;
}

/**
 * Registers the faces imperatively via the FontFace API — for contexts that
 * don't load studio-fonts.css (the parity capture page, served statically).
 * `baseUrl` points at a directory laid out like public/fonts/studio/.
 */
export async function registerStudioFontFaces(baseUrl: string): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  const loads: Promise<unknown>[] = [];
  for (const f of STUDIO_TITLE_FONTS) {
    const weights: (400 | 700)[] = f.supportsBold ? [400, 700] : [400];
    for (const w of weights) {
      const face = new FontFace(f.family, `url(${baseUrl}/${f.stem}-${w}.${f.ext})`, {
        weight: String(w),
        style: 'normal',
      });
      document.fonts.add(face);
      loads.push(face.load().catch(() => undefined));
    }
  }
  await Promise.allSettled(loads);
}
