/**
 * Stage 6: the 3D LUT (.cube) at `intensity`. Ported from media-manipulator-ui
 * `lib/studio/glCompositor.ts` (UI commit e9820f7): `vec3 g = texture(uLut, clamp(c, 0.0, 1.0)).rgb;
 * c = mix(c, g, uLutIntensity);` with the byte cube from the copied `parseCubeLut`.
 *
 * The cube is a 2D atlas of N slices of N x N (slice = blue), read with exact texel taps and
 * interpolated trilinearly in the shader (the Aperture port's `lut3d`, `src/photo/skia/shaders/
 * adjust.ts`). Lookup position: entry `c * (N - 1)`, which is what the export's
 * `lut3d=...:interp=trilinear` (studio_export.go `lut3dPart`, the authoritative render per ADR
 * ws/0002) and the web's CPU reference `sampleLut3D` compute.
 *
 * DEVIATION from the web GLSL (reported in MA62's session log): `texture(uLut, c)` on a 3D texture
 * without the half-texel remap looks up entry `c * N - 0.5` (clamped), not `c * (N - 1)`, so the web
 * PREVIEW skews every LUT towards its ends (for N = 8 an identity cube maps 0.25 to 0.214). The phone
 * follows the export and the CPU reference instead; the web preview should take the remap Aperture's
 * GLSL already has (`(c * (N - 1) + 0.5) / N`).
 */
import { colorStage } from './common';

export const LUT_SKSL = colorStage(
  `uniform shader uLut;    // N slices of NxN, uLutCols slices per atlas row, exact taps
uniform float uLutSize;
uniform float uLutCols;
uniform float uLutIntensity;
float3 lutAt(float x, float y, float z) {
  float col = mod(z, uLutCols);
  float row = floor(z / uLutCols);
  return uLut.eval(float2(col * uLutSize + x + 0.5, row * uLutSize + y + 0.5)).rgb;
}
float3 lut3d(float3 c) {
  float3 f = clamp(c, 0.0, 1.0) * (uLutSize - 1.0);
  float3 i0 = min(float3(uLutSize - 2.0), floor(f));
  float3 t = f - i0;
  float3 c00 = mix(lutAt(i0.x, i0.y, i0.z), lutAt(i0.x + 1.0, i0.y, i0.z), t.x);
  float3 c10 = mix(lutAt(i0.x, i0.y + 1.0, i0.z), lutAt(i0.x + 1.0, i0.y + 1.0, i0.z), t.x);
  float3 c01 = mix(lutAt(i0.x, i0.y, i0.z + 1.0), lutAt(i0.x + 1.0, i0.y, i0.z + 1.0), t.x);
  float3 c11 = mix(lutAt(i0.x, i0.y + 1.0, i0.z + 1.0), lutAt(i0.x + 1.0, i0.y + 1.0, i0.z + 1.0), t.x);
  return mix(mix(c00, c10, t.y), mix(c01, c11, t.y), t.z);
}`,
  `  c = mix(c, lut3d(c), uLutIntensity);`,
);
export const LUT_CHILDREN = ['uIn', 'uLut'] as const;
export const LUT_UNIFORM_FLOATS = 3;
