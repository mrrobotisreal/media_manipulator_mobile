/**
 * Stage 7: chroma key. Ported from media-manipulator-ui `lib/studio/glCompositor.ts` (UI commit
 * e9820f7), line for line: the UV distance to the key colour (`toUV`), `smoothstep` between
 * similarity and similarity + blend into the layer alpha, and the green despill under the keyed
 * part. The web has no CPU reference for this stage (visual-only parity, MA62 tolerance table).
 *
 * Alpha: the GLSL multiplies its running `a` by the key alpha `ca`; here the incoming alpha (the
 * source's, premultiplied) is multiplied the same way, and the despilled colour is premultiplied by
 * the result.
 */
export const CHROMA_SKSL = `
uniform shader uIn;
uniform float3 uKeyColor;
uniform float uSimilarity, uChromaBlend, uDespill;

float2 toUV(float3 c) {
  return float2(dot(c, float3(-0.169, -0.331, 0.5)), dot(c, float3(0.5, -0.419, -0.081)));
}

float4 main(float2 p) {
  float4 s = uIn.eval(p);
  float a = s.a;
  if (a <= 0.0) return float4(0.0);
  float3 c = s.rgb / a;
  float d = distance(toUV(c), toUV(uKeyColor));
  float ca = smoothstep(uSimilarity, uSimilarity + uChromaBlend + 1e-4, d);
  a *= ca;
  c.g = mix(c.g, min(c.g, (c.r + c.b) * 0.5), uDespill * (1.0 - ca));
  return float4(c * a, a);
}
`;
export const CHROMA_CHILDREN = ['uIn'] as const;
export const CHROMA_UNIFORM_FLOATS = 3 + 3;
