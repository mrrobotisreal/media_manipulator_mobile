/**
 * The image the preview shader samples (ticket decision 4, design PHOTO_EDITOR_MOBILE.md §1):
 * the picked file decoded locally by Skia (`Data.fromURI` + `MakeImageFromEncoded`; HEIC through
 * the platform codecs) and downscaled to `PHOTO_PREVIEW_MAX_MP` when larger, or the server's
 * 1920 px proxy when the original is above `PHOTO_LOCAL_DECODE_MAX_MP` or Skia cannot decode it. Skia applies the EXIF orientation while
 * decoding (checked with CanvasKit: an orientation-6 40x20 JPEG decodes 20x40), so the image is
 * upright like the server's ingest; no transform is needed on the canvas.
 *
 * Pure decision logic plus injected I/O, so the choice is tested without native modules.
 */
import { needsProxy, previewSize } from './view';

export type PreviewOrigin = 'local' | 'proxy';

export interface PreviewSource<Img> {
  image: Img;
  origin: PreviewOrigin;
  /** Preview pixels per ORIGINAL pixel (1 for a full local decode; < 1 for the proxy). */
  scale: number;
  width: number;
  height: number;
}

export interface SourceDeps<Img> {
  /** Decodes a local file; null when the codec refuses it. */
  decodeLocal(uri: string): Promise<Img | null>;
  /** Downloads and decodes the project proxy (owner-only route); null on failure. */
  decodeProxy(projectId: string): Promise<Img | null>;
  size(img: Img): { width: number; height: number };
  /** Redraws an image at a smaller size (an offscreen surface); null on failure. */
  downscale(img: Img, width: number, height: number): Img | null;
}

export type LocalPlan = 'decode' | 'wait_for_proxy';

/** Before the decode: a known-large original goes straight to the proxy path. */
export function planLocal(width?: number, height?: number): LocalPlan {
  return needsProxy(width, height) ? 'wait_for_proxy' : 'decode';
}

/** Decode the local file when allowed; null when the editor must wait for the proxy. */
export async function loadLocalPreview<Img>(
  deps: SourceDeps<Img>,
  uri: string,
  known: { width?: number; height?: number },
): Promise<PreviewSource<Img> | null> {
  if (planLocal(known.width, known.height) === 'wait_for_proxy') return null;
  const img = await deps.decodeLocal(uri).catch(() => null);
  if (!img) return null;
  const s = deps.size(img);
  // The probe can miss the size (some HEIC); re-check the decoded size against the cap.
  if (needsProxy(s.width, s.height)) return null;
  const target = previewSize(s.width, s.height);
  if (target.scale === 1)
    return { image: img, origin: 'local', scale: 1, width: s.width, height: s.height };
  const small = deps.downscale(img, target.width, target.height);
  if (!small) return null;
  return {
    image: small,
    origin: 'local',
    scale: target.scale,
    width: target.width,
    height: target.height,
  };
}

/** The proxy preview once the project exists; `original` is the server's EXIF-upright size. */
export async function loadProxyPreview<Img>(
  deps: SourceDeps<Img>,
  projectId: string,
  original: { width: number; height: number },
): Promise<PreviewSource<Img> | null> {
  const img = await deps.decodeProxy(projectId).catch(() => null);
  if (!img) return null;
  const s = deps.size(img);
  const scale = original.width > 0 ? Math.min(1, s.width / original.width) : 1;
  return { image: img, origin: 'proxy', scale, width: s.width, height: s.height };
}
