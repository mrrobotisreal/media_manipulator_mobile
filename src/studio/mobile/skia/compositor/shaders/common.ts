/**
 * Shared SkSL pieces of the Darkroom compositor stages: the constants and the eq helper of the web's
 * fragment shader (media-manipulator-ui `lib/studio/glCompositor.ts` FRAG_SRC, UI commit e9820f7,
 * the last commit that touched it on `main` @ fd25a430), and the premultiplied-in / premultiplied-out
 * wrapper every colour stage uses (Skia child shaders return premultiplied colour; the GLSL works on
 * straight colour, ALPHA MODEL in the web file's header).
 */

/** The GLSL's constants and `applyEqCS`, verbatim (vec3 -> float3). */
export const COLOR_HELPERS_SKSL = `
const float3 LUMA = float3(0.2126, 0.7152, 0.0722);
// vf_vibrance's luma coefficients as applied to (r,g,b): its rc/bc weights are swapped vs BT.709.
const float3 VIB_LUMA = float3(0.072186, 0.715158, 0.212656);

// applyEqCS mirrors ffmpeg's eq filter: contrast scales LUMA about 0.5 (+brightness), saturation
// scales chroma independently of contrast.
float3 applyEqCS(float3 c, float brightness, float contrast, float saturation) {
  float l = dot(c, LUMA);
  float nl = (l - 0.5) * contrast + 0.5 + brightness;
  return clamp(float3(nl) + (c - float3(l)) * saturation, 0.0, 1.0);
}
`;

/**
 * A colour stage: `uIn` (the previous stage) un-premultiplied into `c`, the body computes the new
 * straight `c` (it may read `a`), re-premultiplied. Alpha passes through unchanged.
 */
export function colorStage(decls: string, body: string): string {
  return `
uniform shader uIn;
${decls}
float4 main(float2 p) {
  float4 s = uIn.eval(p);
  float a = s.a;
  if (a <= 0.0) return float4(0.0);
  float3 c = s.rgb / a;
${body}
  return float4(c * a, a);
}
`;
}
