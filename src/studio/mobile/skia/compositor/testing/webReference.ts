/**
 * Test helper (MA62 S2): runs the web's own compositor (`src/studio/compositor/glCompositor.ts`, a
 * byte-identical copy of media-manipulator-ui `lib/studio/glCompositor.ts`) on a recording fake
 * WebGL2 context, and returns what it sent to the GPU per layer: the quad's clip-space positions and
 * UVs (`bufferData`) and every uniform it set before `drawArrays`. The parity suite compares the
 * phone's pure packers with these, so phone and web cannot drift on geometry or uniforms.
 *
 * No pixels: WebGL is not available in jest. Pixel parity of the colour stages is against the web's
 * CPU reference (`studioColorMath.ts`), see `compositorParity.test.ts`.
 */
import { GLCompositor } from '../../../../compositor/glCompositor';
import type { ParsedLut } from '../../../../../photo/studioLutParser';
import type { CompLayer } from '../uniforms';

export interface WebDraw {
  /** TL, BL, TR, BR in clip space (x right, y up), as the web's `quadGeometry` emits them. */
  positions: number[];
  uvs: number[];
  uniforms: Record<string, number[]>;
}

function recordingGl(draws: WebDraw[]) {
  let buffers: Float32Array[] = [];
  let uniforms: Record<string, number[]> = {};
  const set = (loc: unknown, ...v: number[]) => {
    if (typeof loc === 'string') uniforms[loc] = v;
  };
  const impl: Record<string, (...a: unknown[]) => unknown> = {
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getUniformLocation: (_p, name) => name,
    getAttribLocation: (_p, name) => (name === 'aPos' ? 0 : 1),
    getExtension: () => null,
    bufferData: (_t, data) => {
      buffers.push(data as Float32Array);
    },
    uniform1i: (l, a) => set(l, a as number),
    uniform1f: (l, a) => set(l, a as number),
    uniform2f: (l, a, b) => set(l, a as number, b as number),
    uniform3f: (l, a, b, c) => set(l, a as number, b as number, c as number),
    uniform4f: (l, a, b, c, d) => set(l, a as number, b as number, c as number, d as number),
    drawArrays: () => {
      const [pos, uv] = buffers.slice(-2);
      draws.push({ positions: Array.from(pos ?? []), uvs: Array.from(uv ?? []), uniforms });
      buffers = [];
      uniforms = {};
    },
  };
  let enumNo = 0x1000;
  const enums = new Map<string, number>();
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop !== 'string') return undefined;
        if (/^[A-Z0-9_]+$/.test(prop)) {
          if (!enums.has(prop)) enums.set(prop, (enumNo += 1));
          return enums.get(prop);
        }
        return impl[prop] ?? (() => ({}));
      },
    },
  );
}

/**
 * Composites `layers` with the web's GLCompositor at W x H and returns its draw calls. Every slot a
 * layer uses gets a fake uploaded frame; LUT keys in `luts` are loaded (so `hasLut` is true).
 */
export function webDraws(
  layers: readonly CompLayer[],
  W: number,
  H: number,
  luts: Record<string, ParsedLut> = {},
): WebDraw[] {
  const draws: WebDraw[] = [];
  const gl = recordingGl(draws);
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => gl,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  const comp = new GLCompositor();
  if (!comp.init(canvas as never)) throw new Error('reference GLCompositor did not init');
  for (const [key, lut] of Object.entries(luts)) comp.loadLut(key, lut);
  const video = { readyState: 4, videoWidth: 16, videoHeight: 9 };
  for (const l of layers) if (!l.solid && l.imageKey === undefined) comp.uploadSlot(l.slot, video as never, 1);
  comp.composite(layers as never, W, H);
  comp.dispose();
  return draws;
}

/** A minimal stand-in for the `comp` argument of the copied `buildLayersAtTime` (it only calls `hasLut`). */
export const lutPresence = (keys: readonly string[]) => ({ hasLut: (k: string) => keys.includes(k) });
