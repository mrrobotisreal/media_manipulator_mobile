/**
 * The Darkroom title and caption fonts on the phone (ticket MA62 decision 8): one Skia
 * `TypefaceFontProvider` holding the web's families, so a title or caption paragraph names the same
 * family the web's canvas and the export's drawtext / libass use (`04-title-fonts.md`).
 *
 * Where each family comes from (licences checked per family in the font files' own `name` table and
 * the `OFL.txt` that ships with them; the table is `assets/fonts/studio/manifest.json`, built by
 * `scripts/import-studio-fonts.py`):
 * - **Bundled** (OFL 1.1): the 16 title families except DejaVu Sans, and the 6 caption display
 *   families. Ordinary JS assets (`require` of a `.ttf`, loaded with `Skia.Data.fromURI`), so they
 *   reach phones by OTA: nothing goes through `app.config.ts` or the expo-font plugin.
 * - **Downloaded on first use**: DejaVu Sans (Bitstream Vera / Arev licence, not OFL), from the web's
 *   own CDN path `https://www.media-manipulator.com/fonts/studio/dejavu-sans-{400,700}.ttf`, cached
 *   under `Paths.document/studio-fonts/`. Until it arrives, text in it falls back to `FALLBACK`.
 * - **Not loaded**: the caption script fallbacks (Noto Sans Hebrew / Arabic / SC / KR); Skia's
 *   paragraph font fallback picks a system font for those scripts (approximate preview).
 *
 * Pure: the asset resolver, data loader and downloader are injected (`FontDeps`); the app binding is
 * `fontsRuntime.ts`, jest passes file reads over CanvasKit.
 */
import type { SkData, SkTypeface, SkTypefaceFontProvider } from 'react-native-skia';
import type { SkiaApi } from '../compositor/compositor';

/** Families present before anything else loads: the bundled default. */
export const DEFAULT_FAMILY = 'Inter';
/** The family a missing one falls back to in a paragraph's `fontFamilies` list. */
export const FALLBACK = DEFAULT_FAMILY;

/** DejaVu Sans: downloaded from the web on first use (not OFL, so never bundled). */
export const DOWNLOADED: Record<string, Record<number, string>> = {
  'DejaVu Sans': {
    400: '/fonts/studio/dejavu-sans-400.ttf',
    700: '/fonts/studio/dejavu-sans-700.ttf',
  },
};

/** Bundled font modules by family and weight (`require` ids; see `fontsRuntime.ts`). */
export type BundledFonts = Record<string, Record<number, number | string>>;

export interface FontDeps {
  api: SkiaApi;
  bundled: BundledFonts;
  /** The bytes of a bundled module (`Skia.Data.fromURI(resolveAsset(id))` in the app). */
  loadBundled(id: number | string): Promise<SkData>;
  /** The bytes of a downloaded family file, fetched and cached on first use; null when offline. */
  loadDownloaded(path: string): Promise<SkData | null>;
}

export interface StudioFonts {
  /** The provider every paragraph is built with (its families grow as fonts arrive). */
  readonly provider: SkTypefaceFontProvider;
  /** Families registered so far. */
  has(family: string): boolean;
  /** Bumped whenever a family arrives (titles re-record; the web's `fontsVersionRef`). */
  readonly version: number;
  /** Load what is not loaded yet (bundled at once, downloads in the background). */
  ensure(families: readonly string[]): Promise<void>;
  /** Release the provider and every typeface (unmount). */
  dispose(): void;
}

export function createStudioFonts(deps: FontDeps): StudioFonts {
  const provider = deps.api.TypefaceFontProvider.Make();
  const typefaces: SkTypeface[] = [];
  const families = new Set<string>();
  const inflight = new Map<string, Promise<void>>();
  const state = { version: 0, disposed: false };

  const register = (family: string, data: SkData | null) => {
    if (!data || state.disposed) return;
    const tf = deps.api.Typeface.MakeFromData(data);
    try {
      (data as { dispose?: () => void }).dispose?.();
    } catch {
      // the typeface keeps its own copy
    }
    if (!tf) return;
    provider.registerFont(tf, family);
    typefaces.push(tf);
    families.add(family);
  };

  const loadOne = (family: string): Promise<void> => {
    const existing = inflight.get(family);
    if (existing) return existing;
    const run = (async () => {
      const bundled = deps.bundled[family];
      const downloaded = DOWNLOADED[family];
      const jobs: Promise<void>[] = [];
      if (bundled) {
        for (const id of Object.values(bundled)) {
          jobs.push(deps.loadBundled(id).then((d) => register(family, d)));
        }
      } else if (downloaded) {
        for (const path of Object.values(downloaded)) {
          jobs.push(deps.loadDownloaded(path).then((d) => register(family, d)));
        }
      }
      await Promise.allSettled(jobs);
      if (families.has(family)) state.version += 1;
      else inflight.delete(family); // nothing arrived (offline): try again on the next ensure
    })();
    inflight.set(family, run);
    return run;
  };

  return {
    provider,
    has: (family) => families.has(family),
    get version() {
      return state.version;
    },
    async ensure(list) {
      const want = new Set([DEFAULT_FAMILY, ...list]);
      await Promise.allSettled([...want].filter((f) => !families.has(f)).map(loadOne));
    },
    dispose() {
      state.disposed = true;
      for (const tf of typefaces) {
        try {
          tf.dispose();
        } catch {
          // already disposed
        }
      }
      typefaces.length = 0;
      families.clear();
      try {
        provider.dispose();
      } catch {
        // already disposed
      }
    },
  };
}

/** Every family a project's titles and captions name (deduplicated, the default first). */
export function projectFamilies(doc: {
  tracks: readonly {
    clips: readonly { title?: { layers: readonly { type: string; fontFamily?: string }[] } }[];
  }[];
  captionStyle?: { fontFamily?: string } | null;
}): string[] {
  const out = new Set<string>([DEFAULT_FAMILY]);
  for (const tr of doc.tracks) {
    for (const c of tr.clips) {
      for (const l of c.title?.layers ?? [])
        if (l.type === 'text' && l.fontFamily) out.add(l.fontFamily);
    }
  }
  if (doc.captionStyle?.fontFamily) out.add(doc.captionStyle.fontFamily);
  // The caption default (captionsCatalog.json `defaults.fontFamily`) when the style names none.
  else out.add('DejaVu Sans');
  return [...out];
}
