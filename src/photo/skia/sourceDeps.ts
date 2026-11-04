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

/**
 * A healed base's proxy (`bases/<hash>.proxy.jpg`, MM96) for the canvas: cached under
 * `cache/photo/<projectId>/bases/` by hash, decoded with Skia. Null when it cannot be fetched.
 */
export async function decodeBaseProxy(projectId: string, baseRef: string): Promise<SkImage | null> {
  const m = /^bases\/([A-Za-z0-9_-]{1,64})\.png$/.exec(baseRef);
  if (!m) return null;
  const dir = new Directory(photoCacheDir(projectId), 'bases');
  dir.create({ intermediates: true, idempotent: true });
  const dest = new File(dir, `${m[1]}.proxy.jpg`);
  try {
    if (!dest.exists) {
      const headers = await buildHeaders();
      await File.downloadFileAsync(
        `${API_BASE_URL}/photo/projects/${encodeURIComponent(projectId)}/files/bases/${m[1]}.proxy.jpg`,
        dest,
        { headers, idempotent: true },
      );
    }
    return await decodeFile(dest.uri);
  } catch {
    return null;
  }
}

/** Subject mask PNG bytes (`masks/<id>.png`), cached under `cache/photo/<projectId>/masks/`. */
export async function subjectMaskBytes(
  projectId: string,
  maskRef: string,
): Promise<Uint8Array | null> {
  const m = /^masks\/([A-Za-z0-9_-]{1,40})\.png$/.exec(maskRef);
  if (!m) return null;
  const dir = new Directory(photoCacheDir(projectId), 'masks');
  dir.create({ intermediates: true, idempotent: true });
  const dest = new File(dir, `${m[1]}.png`);
  try {
    if (!dest.exists) {
      const headers = await buildHeaders();
      await File.downloadFileAsync(
        `${API_BASE_URL}/photo/projects/${encodeURIComponent(projectId)}/files/${maskRef}`,
        dest,
        { headers, idempotent: true },
      );
    }
    return await dest.bytes();
  } catch {
    return null;
  }
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
