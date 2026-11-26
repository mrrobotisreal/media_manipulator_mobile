/**
 * Real Skia in jest: RN Skia's web API (`JsiSkApi`, the same JS surface `Skia` exposes on device)
 * over CanvasKit (WASM build of the same Skia, shipped as RN Skia's dependency). Lets the parity
 * test compile and run the SkSL on a CPU raster surface. Not a GPU, so it pins the port's math,
 * not the phone's float precision (the Device check covers that by eye).
 */
import type { SkiaApi } from '../shaderChain';

let cached: Promise<SkiaApi> | null = null;
let canvasKit: unknown = null;

/** The raw CanvasKit instance behind `loadSkiaApi()` (MA62: its Canvas2D emulation runs the web's title raster). */
export async function loadCanvasKit(): Promise<unknown> {
  await loadSkiaApi();
  return canvasKit;
}

export function loadSkiaApi(): Promise<SkiaApi> {
  if (!cached) {
    cached = (async () => {
      // jest-expo installs expo's TextDecoder (UTF-8 only); CanvasKit's glue wants UTF-16 too.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { TextDecoder: NodeTextDecoder } = require('node:util') as typeof import('node:util');
      const g = globalThis as { TextDecoder: unknown };
      const previous = g.TextDecoder;
      g.TextDecoder = NodeTextDecoder;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const init = require('canvaskit-wasm/bin/full/canvaskit.js') as (
          o: object,
        ) => Promise<unknown>;
        const CanvasKit = await init({});
        canvasKit = CanvasKit;
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { JsiSkApi } = require('react-native-skia/lib/commonjs/skia/web') as {
          JsiSkApi: (ck: unknown) => SkiaApi;
        };
        return JsiSkApi(CanvasKit);
      } finally {
        g.TextDecoder = previous;
      }
    })();
  }
  return cached;
}
