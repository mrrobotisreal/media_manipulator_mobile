/**
 * Test-only CPU references for the compositor parity suite, built from the web's own code (copied
 * byte for byte, never re-stated):
 * - colour: the web's normative Darkroom colour math (`src/photo/studioColorMath.ts` = UI
 *   `lib/studio/colorMath.ts`: `eqAdjust`, `lumetriAdjust`, `blendChannel`) and, for the LUT, the
 *   web's trilinear `sampleLut3D` (`src/photo/colorMath.ts` = UI `lib/photo/colorMath.ts`, what the
 *   export's `lut3d=interp=trilinear` computes);
 * - the BLEND SPEC of the web compositor's header: `out = mix(backdrop, blendRGB(backdrop, src), a)`
 *   with `a = srcAlpha x opacity`, composited bottom to top over opaque black;
 * - geometry: the quad vertices and UVs the web's `GLCompositor` itself emits (`webReference.ts`),
 *   rasterised by GL's rule for a parallelogram (affine attribute interpolation at pixel centres)
 *   and sampled bilinearly with clamp-to-edge, like `texture()` on a LINEAR texture.
 */
import { sampleLut3D } from '../../../../../photo/colorMath';
import { blendChannel, eqAdjust, lumetriAdjust, type RGB } from '../../../../../photo/studioColorMath';
import type { ParsedLut } from '../../../../../photo/studioLutParser';
import type { CompLayer } from '../uniforms';
import type { WebDraw } from './webReference';

export interface Rgba {
  width: number;
  height: number;
  /** Straight RGBA8. */
  data: Uint8Array;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const to8 = (v: number) => Math.round(clamp01(v) * 255);

/** The colour stages of one layer on a straight RGB, in the web's order. */
export function referenceColor(layer: CompLayer, c: RGB, luts: Record<string, ParsedLut>): RGB {
  let o = c;
  if (layer.eq) o = eqAdjust(o, layer.eq.brightness, layer.eq.contrast, layer.eq.saturation);
  if (layer.lumetri) o = lumetriAdjust(o, layer.lumetri);
  if (layer.lut && luts[layer.lut.key]) {
    const g = sampleLut3D(luts[layer.lut.key]!, o);
    const i = clamp01(layer.lut.intensity);
    o = [o[0] + (g[0] - o[0]) * i, o[1] + (g[1] - o[1]) * i, o[2] + (g[2] - o[2]) * i];
  }
  return [clamp01(o[0]), clamp01(o[1]), clamp01(o[2])];
}

/**
 * Composites pixel-aligned layers (identity geometry: every source is exactly W x H) bottom to top
 * over opaque black, per the web's BLEND SPEC. `sources[i]` is layer i's straight RGBA image.
 */
export function referenceComposite(
  layers: readonly CompLayer[],
  sources: readonly Rgba[],
  W: number,
  H: number,
  luts: Record<string, ParsedLut>,
): Rgba {
  const out = new Uint8Array(W * H * 4);
  for (let p = 0; p < W * H; p += 1) {
    let b: RGB = [0, 0, 0];
    layers.forEach((layer, li) => {
      const s = sources[li]!;
      const o = p * 4;
      const c: RGB = [s.data[o]! / 255, s.data[o + 1]! / 255, s.data[o + 2]! / 255];
      const a = clamp01((s.data[o + 3]! / 255) * clamp01(layer.opacity));
      const g = referenceColor(layer, c, luts);
      const mode = layer.blendMode ?? 'normal';
      b = [0, 1, 2].map((k) => b[k]! + (blendChannel(mode, b[k]!, g[k]!) - b[k]!) * a) as RGB;
    });
    out[p * 4] = to8(b[0]);
    out[p * 4 + 1] = to8(b[1]);
    out[p * 4 + 2] = to8(b[2]);
    out[p * 4 + 3] = 255;
  }
  return { width: W, height: H, data: out };
}

/** Bilinear sample (clamp to edge) of a straight RGBA image at pixel coordinate (x, y), 0..1 floats. */
function bilinear(img: Rgba, x: number, y: number): [number, number, number, number] {
  const fx = x - 0.5;
  const fy = y - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (xi: number, yi: number, k: number) => {
    const cx = Math.max(0, Math.min(img.width - 1, xi));
    const cy = Math.max(0, Math.min(img.height - 1, yi));
    return img.data[(cy * img.width + cx) * 4 + k]! / 255;
  };
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let k = 0; k < 4; k += 1) {
    const top = at(x0, y0, k) * (1 - tx) + at(x0 + 1, y0, k) * tx;
    const bot = at(x0, y0 + 1, k) * (1 - tx) + at(x0 + 1, y0 + 1, k) * tx;
    out[k] = top * (1 - ty) + bot * ty;
  }
  return out;
}

/**
 * MA62 S3 (transitions): the web's draw calls for one frame, rasterised by GL's rule and composited
 * bottom to top over opaque black with the BLEND SPEC (normal blend), exactly what the web's
 * fragment shader does with the switches transitions use and nothing else:
 * - `uHasSolid` (a dip's colour layer): `c = uSolidColor`, `a = 1 * uOpacity`, full-canvas quad;
 * - `uHasWipe`: `a = 0` where the pixel centre's canvas fraction (top-left origin, the GLSL's
 *   flipped `gl_FragCoord`) is outside `[uWipe.x, 1 - uWipe.z] x [uWipe.y, 1 - uWipe.w]`;
 * - otherwise the source sampled bilinearly at the affine UV (`referenceGeometry`'s rule).
 * `sources[i]` is draw i's source image (ignored for a solid draw). No colour stage is set by any
 * transition scenario, so none is applied here (the parity suite asserts the web set none).
 */
export function referenceDraws(draws: readonly WebDraw[], sources: readonly (Rgba | null)[], W: number, H: number): Rgba {
  const out = new Uint8Array(W * H * 4);
  const acc = new Float64Array(W * H * 3);
  draws.forEach((draw, di) => {
    const u = draw.uniforms;
    const solid = u.uHasSolid?.[0] === 1 ? u.uSolidColor! : null;
    const src = sources[di] ?? null;
    const opacity = clamp01(u.uOpacity?.[0] ?? 1);
    const wipe = u.uHasWipe?.[0] === 1 ? u.uWipe! : null;
    const px = (i: number): [number, number] => [
      ((draw.positions[i * 2]! + 1) / 2) * W,
      ((1 - draw.positions[i * 2 + 1]!) / 2) * H,
    ];
    const tl = px(0);
    const bl = px(1);
    const tr = px(2);
    const ex = [tr[0] - tl[0], tr[1] - tl[1]];
    const ey = [bl[0] - tl[0], bl[1] - tl[1]];
    const det = ex[0]! * ey[1]! - ey[0]! * ex[1]!;
    const u0 = draw.uvs[0]!;
    const v0 = draw.uvs[1]!;
    const u1 = draw.uvs[4]!;
    const v1 = draw.uvs[3]!;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const dx = x + 0.5 - tl[0];
        const dy = y + 0.5 - tl[1];
        const qx = (dx * ey[1]! - dy * ey[0]!) / det;
        const qy = (ex[0]! * dy - ex[1]! * dx) / det;
        if (qx < 0 || qx > 1 || qy < 0 || qy > 1) continue;
        let c: [number, number, number];
        let a: number;
        if (solid) {
          c = [solid[0]!, solid[1]!, solid[2]!];
          a = opacity;
        } else {
          if (!src) continue;
          const s = bilinear(src, (u0 + (u1 - u0) * qx) * src.width, (v0 + (v1 - v0) * qy) * src.height);
          // The texture holds straight colour (the web uploads unpremultiplied RGBA).
          c = [s[0], s[1], s[2]];
          a = s[3] * opacity;
        }
        if (wipe) {
          const fx = (x + 0.5) / W;
          const fy = (y + 0.5) / H;
          if (fx < wipe[0]! || fx > 1 - wipe[2]! || fy < wipe[1]! || fy > 1 - wipe[3]!) a = 0;
        }
        a = clamp01(a);
        const o = (y * W + x) * 3;
        for (let k = 0; k < 3; k += 1) acc[o + k] = acc[o + k]! + (clamp01(c[k]!) - acc[o + k]!) * a;
      }
    }
  });
  for (let p = 0; p < W * H; p += 1) {
    out[p * 4] = to8(acc[p * 3]!);
    out[p * 4 + 1] = to8(acc[p * 3 + 1]!);
    out[p * 4 + 2] = to8(acc[p * 3 + 2]!);
    out[p * 4 + 3] = 255;
  }
  return { width: W, height: H, data: out };
}

/**
 * One web draw call rasterised over opaque black (normal blend): the quad from `draw.positions`
 * (clip space, TL BL TR BR) covers the pixels whose centre maps inside it, the UV is the affine
 * interpolation of `draw.uvs`, the source is sampled bilinearly, and the colour lands with
 * `a = srcAlpha x uOpacity` (the uniform the web set) per the BLEND SPEC.
 */
export function referenceGeometry(draw: WebDraw, src: Rgba, W: number, H: number): Rgba {
  const px = (i: number): [number, number] => [
    ((draw.positions[i * 2]! + 1) / 2) * W,
    ((1 - draw.positions[i * 2 + 1]!) / 2) * H,
  ];
  const tl = px(0);
  const bl = px(1);
  const tr = px(2);
  const ex = [tr[0] - tl[0], tr[1] - tl[1]];
  const ey = [bl[0] - tl[0], bl[1] - tl[1]];
  const det = ex[0]! * ey[1]! - ey[0]! * ex[1]!;
  const u0 = draw.uvs[0]!;
  const v0 = draw.uvs[1]!;
  const u1 = draw.uvs[4]!;
  const v1 = draw.uvs[3]!;
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const dx = x + 0.5 - tl[0];
      const dy = y + 0.5 - tl[1];
      const qx = (dx * ey[1]! - dy * ey[0]!) / det;
      const qy = (ex[0]! * dy - ex[1]! * dx) / det;
      const o = (y * W + x) * 4;
      out[o + 3] = 255;
      if (qx < 0 || qx > 1 || qy < 0 || qy > 1) continue;
      const s = bilinear(src, (u0 + (u1 - u0) * qx) * src.width, (v0 + (v1 - v0) * qy) * src.height);
      const a = s[3] * clamp01(draw.uniforms.uOpacity?.[0] ?? 1);
      out[o] = to8(s[0] * a);
      out[o + 1] = to8(s[1] * a);
      out[o + 2] = to8(s[2] * a);
    }
  }
  return { width: W, height: H, data: out };
}
