/**
 * Test helpers: a golden fixture image as a pipeline source on CanvasKit (exact straight colour +
 * alpha, so transparent pixels keep their colour like the float reference), and brush PNG data
 * URIs decoded to the grey rasters the mask passes read.
 */
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import type { SkImage } from '@shopify/react-native-skia';
import { brushAlpha } from '../../goldens';
import type { AlphaSource, PipelineSource } from '../pipeline';
import type { SkiaApi } from '../shaderChain';

const FIXTURES = `${__dirname}/../../fixtures`;

export function rgbaImage(
  api: SkiaApi,
  width: number,
  height: number,
  bytes: Uint8Array,
  opaque = false,
): SkImage {
  const img = api.Image.MakeImage(
    { width, height, colorType: 4, alphaType: opaque ? 1 : 3 },
    api.Data.fromBytes(bytes),
    width * 4,
  );
  if (!img) throw new Error('MakeImage');
  return img;
}

export function fixtureSource(api: SkiaApi, name: string): PipelineSource {
  const png = PNG.sync.read(readFileSync(`${FIXTURES}/images/${name}.png`));
  const color = new Uint8Array(png.data);
  const alpha = new Uint8Array(png.data);
  for (let i = 0; i < color.length; i += 4) {
    color[i + 3] = 255;
    alpha[i] = alpha[i + 1] = alpha[i + 2] = png.data[i + 3]!;
    alpha[i + 3] = 255;
  }
  return {
    id: name,
    image: rgbaImage(api, png.width, png.height, new Uint8Array(png.data)),
    split: {
      color: rgbaImage(api, png.width, png.height, color, true),
      alpha: rgbaImage(api, png.width, png.height, alpha, true),
    },
  };
}

/** Brush PNG data URIs decoded (pngjs) to grey rasters; everything else (subject refs) absent. */
export function brushAlphaSource(api: SkiaApi): AlphaSource {
  const cache = new Map<string, SkImage | null>();
  return {
    get(id) {
      if (!cache.has(id)) {
        const a = id.startsWith('data:') ? brushAlpha(id) : null;
        if (!a) cache.set(id, null);
        else {
          const rgba = new Uint8Array(a.width * a.height * 4);
          for (let i = 0; i < a.alpha.length; i += 1) {
            const v = a.alpha[i] as number;
            rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v;
            rgba[i * 4 + 3] = 255;
          }
          cache.set(id, rgbaImage(api, a.width, a.height, rgba, true));
        }
      }
      return cache.get(id) ?? null;
    },
  };
}
