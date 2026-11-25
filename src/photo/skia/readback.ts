/**
 * Pixel readback on react-native-skia 3 (MA60). `readPixels`, `encodeToBytes` and `encodeToBase64`
 * return promises in v3, and a Promise is not a `Uint8Array`: a site that forgets `await` and then
 * checks `instanceof Uint8Array` compiles and silently takes its fallback branch (the histogram, the
 * preset thumbnails, the auto-dehaze estimate and the subject-mask alpha rule would all quietly
 * break). Every readback goes through `pixelBytes(await …)`, which turns that mistake into an error.
 */

const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  typeof v === 'object' && v !== null && typeof (v as { then?: unknown }).then === 'function';

/** The RGBA8 bytes of an awaited readback, or null when Skia read nothing. Throws on a Promise. */
export function pixelBytes(px: unknown): Uint8Array | null {
  if (isThenable(px))
    throw new Error('Skia readback was not awaited (a Promise reached pixel code)');
  return px instanceof Uint8Array ? px : null;
}
