/**
 * Stage 9: the backdrop blend. Ported from media-manipulator-ui `lib/studio/glCompositor.ts` (UI
 * commit e9820f7) `blendRGB` and the final `mix(backdrop, blendRGB(backdrop, c), clamp(a))` (BLEND
 * SPEC in its header); the CPU reference is the copied `studioColorMath.ts` `blendChannel`.
 *
 * Skia's separable `BlendMode`s compute, on premultiplied colour over an OPAQUE backdrop (the web's
 * composite base is opaque black and every layer leaves it opaque), exactly
 * `b + a * (blend(b, c) - b)` for normal (SrcOver), multiply, screen, overlay (it conditions on the
 * backdrop, like the web's `step(0.5, b)`; at b = 0.5 both branches agree), lighten, darken and
 * difference. Those draw the layer's chain with the paint's blend mode: no backdrop read.
 *
 * `addition` does not match: Skia's `Plus` is `min(b + a*c, 1)`, the web's is
 * `b + a * (min(b + c, 1) - b)`. It is drawn in a layer that starts as a copy of the backdrop
 * (`saveLayer` with `SaveLayerInitWithPrevious`): the layer's straight colour at full alpha with
 * `Plus` (giving `min(b + c, 1)`), then the layer's own alpha with `DstIn` (scaling by `a`), and the
 * restore's SrcOver lands `a * min(b + c, 1) + (1 - a) * b`: the web's formula, with no snapshot of
 * the composite per frame. `OPAQUE_SKSL` is the one SkSL this needs (the un-premultiplied colour).
 * The parity suite renders every mode both through this and against `blendChannel`.
 */
import type { StudioBlendMode } from '../../../../studioTypes';

/** RN Skia `BlendMode` values (numeric: a pure module must not import RN Skia at runtime). */
export const SK_BLEND = {
  Src: 1,
  SrcOver: 3,
  DstIn: 6,
  Plus: 12,
  Screen: 14,
  Overlay: 15,
  Darken: 16,
  Lighten: 17,
  Difference: 22,
  Multiply: 24,
} as const;

/** RN Skia `SaveLayerFlag.SaveLayerInitWithPrevious`. */
export const SAVE_LAYER_INIT_WITH_PREVIOUS = 1 << 2;

/** The web's `BLEND_INDEX` (glCompositor.ts). */
export const BLEND_INDEX: Record<StudioBlendMode, number> = {
  normal: 0,
  multiply: 1,
  screen: 2,
  overlay: 3,
  lighten: 4,
  darken: 5,
  addition: 6,
  difference: 7,
};

/** Modes Skia's `BlendMode` reproduces exactly (see the header); `addition` takes the layer route. */
export const SKIA_BLEND_FOR: Record<Exclude<StudioBlendMode, 'addition'>, number> = {
  normal: SK_BLEND.SrcOver,
  multiply: SK_BLEND.Multiply,
  screen: SK_BLEND.Screen,
  overlay: SK_BLEND.Overlay,
  lighten: SK_BLEND.Lighten,
  darken: SK_BLEND.Darken,
  difference: SK_BLEND.Difference,
};

/** The layer's straight colour at alpha 1 (0 where it has no coverage): the `Plus` pass of `addition`. */
export const OPAQUE_SKSL = `
uniform shader uIn;
float4 main(float2 p) {
  float4 s = uIn.eval(p);
  if (s.a <= 0.0) return float4(0.0);
  return float4(clamp(s.rgb / s.a, 0.0, 1.0), 1.0);
}
`;
export const OPAQUE_CHILDREN = ['uIn'] as const;
export const OPAQUE_UNIFORM_FLOATS = 0;
