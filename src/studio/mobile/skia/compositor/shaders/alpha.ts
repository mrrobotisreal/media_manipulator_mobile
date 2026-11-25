/**
 * Stage 8: alpha. Ported from media-manipulator-ui `lib/studio/glCompositor.ts` (UI commit e9820f7):
 * `float a = src.a * uOpacity;`, the canvas-space wipe mask (part 14: alpha 0 outside the revealed
 * region; used by S3's wipe transitions, a no-op otherwise), and `c = clamp(c, 0.0, 1.0)` before
 * the blend. The GLSL applies opacity and the wipe before the colour stages, but they only scale
 * `a`, which no colour stage reads, so applying them last is the same product.
 */
export const ALPHA_SKSL = `
uniform shader uIn;
uniform float uOpacity;   // clip opacity x transition alpha, clamped 0..1 by the packer (clamp01 in drawLayer)
uniform float uHasWipe;
uniform float4 uWipe;     // left, top, right, bottom: canvas fractions hidden
uniform float2 uOutSize;  // canvas pixels

float4 main(float2 p) {
  float4 s = uIn.eval(p);
  float a = s.a;
  if (a <= 0.0) return float4(0.0);
  float3 c = clamp(s.rgb / a, 0.0, 1.0);
  a *= uOpacity;
  if (uHasWipe > 0.5) {
    float2 tl = p / uOutSize; // top-left origin, like the GLSL's flipped gl_FragCoord
    if (tl.x < uWipe.x || tl.x > 1.0 - uWipe.z || tl.y < uWipe.y || tl.y > 1.0 - uWipe.w) a = 0.0;
  }
  a = clamp(a, 0.0, 1.0);
  return float4(c * a, a);
}
`;
export const ALPHA_CHILDREN = ['uIn'] as const;
export const ALPHA_UNIFORM_FLOATS = 1 + 1 + 4 + 2;
