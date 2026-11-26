/**
 * The app binding of `fonts.ts` (MA62): the bundled font modules (ordinary JS assets, so they ship
 * by OTA; nothing in `app.config.ts`), read with `Skia.Data.fromURI`, and the one downloaded family
 * (DejaVu Sans) fetched from the web's CDN path into `Paths.document/studio-fonts/` on first use.
 * Kept apart from the pure module so jest never loads native code.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { Image } from 'react-native';
import { Skia } from 'react-native-skia';
import { WEB_BASE_URL } from '@/lib/webUrl';
import { BUNDLED_FONTS } from './bundledFonts';
import { createStudioFonts, type StudioFonts } from './fonts';

/** `Paths.document/studio-fonts/`: the downloaded families (kept across launches, unlike the cache). */
const FONT_DIR = 'studio-fonts';

async function loadDownloaded(path: string) {
  const name = path.split('/').pop()!;
  try {
    const dir = new Directory(Paths.document, FONT_DIR);
    dir.create({ intermediates: true, idempotent: true });
    const file = new File(dir, name);
    if (!file.exists || file.size === 0) {
      await File.downloadFileAsync(`${WEB_BASE_URL}${path}`, file, { idempotent: true });
    }
    return await Skia.Data.fromURI(file.uri);
  } catch {
    return null; // offline or the CDN failed: the fallback family stays until the next ensure()
  }
}

/** One font set for the app run (fonts are read-only and shared by every preview). */
let shared: StudioFonts | null = null;

export function studioFonts(): StudioFonts {
  if (!shared) {
    shared = createStudioFonts({
      api: Skia,
      bundled: BUNDLED_FONTS,
      loadBundled: (id) => {
        const src = Image.resolveAssetSource(id as number);
        return Skia.Data.fromURI(src.uri);
      },
      loadDownloaded,
    });
  }
  return shared;
}
