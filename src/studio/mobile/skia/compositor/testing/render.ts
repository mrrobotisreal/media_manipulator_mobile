/** Test helper: draw a frame through the phone `Compositor` on a CanvasKit raster surface and read it back. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import type { SkImage } from 'react-native-skia';
import { Compositor, type FrameLayer, type SkiaApi } from '../compositor';
import type { Rgba } from './reference';

const FIXTURE_DIR = join(__dirname, '..', '..', '..', '..', '..', 'photo', 'fixtures', 'images');

/** The web's photo fixture images (synced from UI `lib/photo/fixtures/images`): straight RGBA. */
export function fixtureImage(name: 'photo' | 'chart' | 'alpha'): Rgba {
  const png = PNG.sync.read(readFileSync(join(FIXTURE_DIR, `${name}.png`)));
  return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
}

export function makeImage(api: SkiaApi, img: Rgba): SkImage {
  const out = api.Image.MakeRaster(
    { width: img.width, height: img.height, colorType: 4, alphaType: 3 },
    api.Data.fromBytes(img.data),
    img.width * 4,
  );
  if (!out) throw new Error('MakeRaster');
  return out;
}

export async function renderFrame(
  api: SkiaApi,
  comp: Compositor,
  layers: readonly FrameLayer[],
  W: number,
  H: number,
): Promise<Rgba> {
  const surface = api.Surface.MakeRaster(W, H);
  if (!surface) throw new Error('surface');
  comp.draw(surface.getCanvas(), layers, W, H);
  surface.flush();
  const snap = surface.makeImageSnapshot();
  const px = await snap.readPixels(0, 0, { width: W, height: H, colorType: 4, alphaType: 3 });
  snap.dispose();
  surface.dispose();
  comp.endFrame();
  if (!(px instanceof Uint8Array)) throw new Error('readPixels');
  return { width: W, height: H, data: px };
}

/** Max and mean absolute 8-bit RGB difference (diagnostics next to the parity metric). */
export function diff8(a: Rgba, b: Rgba): { max: number; mean: number } {
  let max = 0;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    for (let k = 0; k < 3; k += 1) {
      const d = Math.abs(a.data[i + k]! - b.data[i + k]!);
      if (d > max) max = d;
      sum += d;
      n += 1;
    }
  }
  return { max, mean: sum / n };
}
