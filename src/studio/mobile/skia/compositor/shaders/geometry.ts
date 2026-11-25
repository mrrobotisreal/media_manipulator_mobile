/**
 * Stage 1-3: crop -> fit -> transform. Ported from media-manipulator-ui `lib/studio/glCompositor.ts`
 * (UI commit e9820f7): the SHARED TRANSFORM SPEC in its header, `quadGeometry()` (the quad's corners
 * and UVs) and the vertex stage (`gl_Position = aPos`, `vUV = aUV`, `texture(uSource, vUV)`).
 *
 * WebGL rasterises the quad as two triangles and interpolates the UVs affinely; for this
 * parallelogram that is exactly the inverse affine map from a canvas pixel to the quad's unit square
 * (0..1 across, 0..1 down), then `uv = mix(cropMin, cropMax, q)`. A pixel whose centre is outside the
 * quad is transparent (the GL quad does not cover it). The source is sampled bilinearly in its own
 * pixels (`texture()` with LINEAR + CLAMP_TO_EDGE = an image shader with linear filtering and clamp
 * tiling), so the sample at `uv` is the same texel blend.
 *
 * The three stages are one effect because they are one affine map on the web too (the vertex stage
 * computes the whole of crop, fit and transform); splitting them would only add two identity passes.
 * `uniforms.ts` `packGeometry` derives the map from `layerQuad` (the port of `quadGeometry`).
 */
export const GEOMETRY_SKSL = `
uniform shader uSource;
uniform float4 uM;       // canvas px -> quad unit: q = (uM.x*px + uM.y*py + uT.x, uM.z*px + uM.w*py + uT.y)
uniform float2 uT;
uniform float4 uCrop;    // u0, v0, u1, v1 (the quad's UV rectangle)
uniform float2 uSrcSize; // source pixels

float4 main(float2 p) {
  float qx = uM.x * p.x + uM.y * p.y + uT.x;
  float qy = uM.z * p.x + uM.w * p.y + uT.y;
  if (qx < 0.0 || qx > 1.0 || qy < 0.0 || qy > 1.0) return float4(0.0);
  float2 uv = float2(mix(uCrop.x, uCrop.z, qx), mix(uCrop.y, uCrop.w, qy));
  return uSource.eval(uv * uSrcSize);
}
`;
export const GEOMETRY_CHILDREN = ['uSource'] as const;
export const GEOMETRY_UNIFORM_FLOATS = 4 + 2 + 4 + 2;
