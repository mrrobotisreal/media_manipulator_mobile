/**
 * The native side of `source.ts`: Skia decoding and the authenticated proxy download. The proxy
 * route is owner-only, so the request carries `buildHeaders()` (the one header builder); the file
 * lands in `cache/photo/<projectId>/proxy` and is decoded from there.
 */
import { Skia, type SkImage } from '@shopify/react-native-skia';
import { Directory, File, Paths } from 'expo-file-system';
import { buildHeaders } from '@/api/baseQuery';
import { API_BASE_URL } from '@/api/config';
import type { SourceDeps } from '../source';

export const photoCacheDir = (projectId: string) => new Directory(Paths.cache, 'photo', projectId);

async function decodeFile(uri: string): Promise<SkImage | null> {
  const data = await Skia.Data.fromURI(uri);
  return Skia.Image.MakeImageFromEncoded(data);
}

export const skiaSourceDeps: SourceDeps<SkImage> = {
  decodeLocal: decodeFile,
  async decodeProxy(projectId) {
    const dir = photoCacheDir(projectId);
    dir.create({ intermediates: true, idempotent: true });
    const dest = new File(dir, 'proxy');
    if (!dest.exists) {
      const headers = await buildHeaders();
      await File.downloadFileAsync(
        `${API_BASE_URL}/photo/projects/${encodeURIComponent(projectId)}/proxy`,
        dest,
        { headers, idempotent: true },
      );
    }
    return decodeFile(dest.uri);
  },
  size: (img) => ({ width: img.width(), height: img.height() }),
  downscale(img, width, height) {
    const surface = Skia.Surface.MakeOffscreen(width, height);
    if (!surface) return null;
    const paint = Skia.Paint();
    surface
      .getCanvas()
      .drawImageRect(
        img,
        Skia.XYWHRect(0, 0, img.width(), img.height()),
        Skia.XYWHRect(0, 0, width, height),
        paint,
      );
    surface.flush();
    // A raster copy: the offscreen surface's GPU texture is not shared across Skia views.
    return surface.makeImageSnapshot().makeNonTextureImage();
  },
};
