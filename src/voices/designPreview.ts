import { Directory, File, Paths } from 'expo-file-system';

/** `cache/voice-previews/` holds the design previews' MP3s (the swept cache; nothing here is kept). */
export const PREVIEW_DIR = 'voice-previews';

/** Number of bytes a base64 string decodes to (for the empty check without decoding twice). */
export const base64Bytes = (b64: string): number =>
  Math.floor((b64.replace(/=+$/, '').length * 3) / 4);

/**
 * Writes the preview's inline MP3 (`audioBase64`) to a cache file the player can open and returns its
 * `file://` URI (ticket MA34 decision 6). One file per seed: "Try another" leaves the older ones to the
 * next sweep, and `clearPreviews` removes them when the screen closes.
 */
export function writePreviewFile(audioBase64: string, seed: number): string {
  const dir = new Directory(Paths.cache, PREVIEW_DIR);
  dir.create({ intermediates: true, idempotent: true });
  const file = new File(dir, `design-${seed}.mp3`);
  file.write(audioBase64, { encoding: 'base64' });
  return file.uri;
}

export function clearPreviews(): void {
  try {
    const dir = new Directory(Paths.cache, PREVIEW_DIR);
    if (dir.exists) dir.delete();
  } catch {
    // best effort
  }
}
