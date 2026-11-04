/**
 * SkSL port of the web's MM98 passes (media-manipulator-ui `lib/photo/gl/shaders/maskGeoSource.ts`,
 * UI main 615d7c0): the geometry resample, one pass per mask component (fold left to right), and
 * the mask finish (invert, opacity) and views. Stage for stage with `colorMath.ts`
 * (`applyGeometryCPU`, `renderMaskCPU`); the CanvasKit parity test renders the mask and geometry
 * goldens through these sources.
 *
 * Mechanical differences from the GLSL (SkSL has no preprocessor, no sampler uniforms, no
 * `texelFetch`; RN Skia packs every uniform as float):
 * - one source per pass (the GLSL's `#define T_*`), coordinates are pixel centres `p`;
 * - textures are child shaders with nearest sampling, read with exact texel taps
 *   (`tapA(q)` = `uAlpha.eval(q + 0.5)`; SkSL has no shader-typed parameters), so bilinear filtering is done in the
 *   shader exactly like `colorMath` (texel centres at +0.5, edges clamped);
 * - the working image is straight (un-premultiplied) colour in an opaque image plus a separate
 *   alpha image (see `pipeline.ts`), so the geometry pass runs twice (colour, then alpha);
 * - the feather blur is Skia's `ImageFilter.MakeBlur` on the mask surface (ticket MA51 decision 2),
 *   not the GLSL's `T_MBLUR` loop; invert and opacity are a lazy finish shader (`MASK_FINISH`).
 */

/** Exact texel read and the shared helpers. `uSize` = output (mask / image) size in pixels. */
const HEADER = `
float sstep(float e0, float e1, float x) {
  if (e1 == e0) return x < e0 ? 0.0 : 1.0;
  float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
`;

/**
 * Geometry (T_GEOMETRY): inverse map of output pixel `p` (crop -> perspective -> flip -> rotate)
 * into the source, bilinear on exact taps. `uOut` 0 = colour (rgb, opaque), 1 = alpha (a, a, a).
 * uG0 = (w0, h0, wr, hr), uG1 = (ox, oy, wo, ho), uG2 = (cos, sin, flipH, flipV),
 * uG3/uG4 = homography a..h, uG5 = (hasPersp, fillMode 0 transparent / 1 edge / 2 colour, out, 0).
 */
export const GEOMETRY_SKSL = `
uniform shader uColor;
uniform shader uAlpha;
uniform float4 uG0;
uniform float4 uG1;
uniform float4 uG2;
uniform float4 uG3;
uniform float4 uG4;
uniform float4 uG5;
uniform float4 uFill;
${HEADER}
float4 tapC(float2 q) { return uColor.eval(q + 0.5); }
float4 tapA(float2 q) { return uAlpha.eval(q + 0.5); }
float4 sampleAt(float2 s) {
  float2 pp = s - 0.5;
  float2 p0 = floor(pp);
  float2 t = pp - p0;
  float2 hi = uG0.xy - 1.0;
  float2 a = clamp(p0, float2(0.0), hi);
  float2 b = clamp(p0 + 1.0, float2(0.0), hi);
  if (uG5.z > 0.5) {
    float top = mix(tapA(float2(a.x, a.y)).r, tapA(float2(b.x, a.y)).r, t.x);
    float bot = mix(tapA(float2(a.x, b.y)).r, tapA(float2(b.x, b.y)).r, t.x);
    return float4(float3(mix(top, bot, t.y)), 1.0);
  }
  float3 top = mix(tapC(float2(a.x, a.y)).rgb, tapC(float2(b.x, a.y)).rgb, t.x);
  float3 bot = mix(tapC(float2(a.x, b.y)).rgb, tapC(float2(b.x, b.y)).rgb, t.x);
  return float4(mix(top, bot, t.y), 1.0);
}
float4 main(float2 p) {
  float2 q = float2(uG1.x + p.x, uG1.y + p.y);
  if (uG5.x > 0.5) {
    float2 uv = q / uG0.zw;
    float den = uG4.z * uv.x + uG4.w * uv.y + 1.0;
    q = float2((uG3.x * uv.x + uG3.y * uv.y + uG3.z) / den, (uG3.w * uv.x + uG4.x * uv.y + uG4.y) / den) * uG0.zw;
  }
  if (uG2.z > 0.5) q.x = uG0.z - q.x;
  if (uG2.w > 0.5) q.y = uG0.w - q.y;
  float2 d = q - uG0.zw * 0.5;
  float2 s = uG0.xy * 0.5 + float2(d.x * uG2.x + d.y * uG2.y, -d.x * uG2.y + d.y * uG2.x);
  bool inside = s.x >= 0.0 && s.x <= uG0.x && s.y >= 0.0 && s.y <= uG0.y;
  if (!inside && uG5.y < 0.5) return float4(0.0, 0.0, 0.0, 1.0);
  if (!inside && uG5.y > 1.5) return uG5.z > 0.5 ? float4(1.0) : float4(float3(uFill.rgb), 1.0);
  return float4(sampleAt(s));
}
`;

/** Mask component passes: every one folds its value into `uPrev` (uMode 0 add, 1 subtract, 2 intersect). */
const FOLD = `
uniform shader uSource;
uniform shader uPrev;
uniform shader uAlpha;
uniform float2 uSize;
uniform float uMode;
uniform float uFirst;
uniform float4 uM0;
uniform float4 uM1;
uniform float4 uLab[16];
uniform float2 uAlphaSize;
${HEADER}
float4 tapA(float2 q) { return uAlpha.eval(q + 0.5); }
float fold(float prev, float v) {
  if (uMode < 0.5) return max(prev, v);
  if (uMode < 1.5) return min(prev, 1.0 - v);
  return min(prev, v);
}
float prevAt(float2 p) { return uFirst > 0.5 ? 0.0 : uPrev.eval(p).r; }
float3 srgbToLinear(float3 v) {
  return mix(pow((v + 0.055) / 1.055, float3(2.4)), v / 12.92, step(v, float3(0.04045)));
}
float3 rgbToLab(float3 c) {
  float3 l = srgbToLinear(c);
  float x = (0.4124564 * l.r + 0.3575761 * l.g + 0.1804375 * l.b) / 0.95047;
  float y = 0.2126729 * l.r + 0.7151522 * l.g + 0.072175 * l.b;
  float z = (0.0193339 * l.r + 0.119192 * l.g + 0.9503041 * l.b) / 1.08883;
  float3 t = float3(x, y, z);
  float3 f = mix((24389.0 / 27.0 * t + 16.0) / 116.0, pow(max(t, float3(0.0)), float3(1.0 / 3.0)), step(float3(216.0 / 24389.0), t) * (1.0 - step(t, float3(216.0 / 24389.0))));
  return float3(116.0 * f.y - 16.0, 500.0 * (f.x - f.y), 200.0 * (f.y - f.z));
}
// colorMath sampleAlpha: bilinear at normalized (nx, ny), texel centres at +0.5, edges clamped.
float alphaAt(float2 n) {
  float2 u = n * uAlphaSize - 0.5;
  float2 p0 = floor(u);
  float2 t = u - p0;
  float2 hi = uAlphaSize - 1.0;
  float2 a = clamp(p0, float2(0.0), hi);
  float2 b = clamp(p0 + 1.0, float2(0.0), hi);
  float top = mix(tapA(float2(a.x, a.y)).r, tapA(float2(b.x, a.y)).r, t.x);
  float bot = mix(tapA(float2(a.x, b.y)).r, tapA(float2(b.x, b.y)).r, t.x);
  return mix(top, bot, t.y);
}
`;

const COMPONENT_BODY = {
  // smoothstep(-f, 1+f, t), t = projection on from->to in pixel space (0 at from, 1 at to).
  gradient: `
  float2 f = uM0.xy * uSize;
  float2 dd = uM0.zw * uSize - f;
  float len2 = dot(dd, dd);
  float v = len2 < 1e-12 ? 0.0 : sstep(-uM1.x, 1.0 + uM1.x, dot(p - f, dd) / len2);`,
  // Ellipse rotated clockwise (y down): 1 inside (1-f) of the radius, 0 at the rim.
  radial: `
  float2 dd = p - uM0.xy * uSize;
  float u = dd.x * uM1.x + dd.y * uM1.y;
  float w = -dd.x * uM1.y + dd.y * uM1.x;
  float2 r = max(uM0.zw * uSize, float2(1e-6));
  float dist = sqrt((u / r.x) * (u / r.x) + (w / r.y) * (w / r.y));
  float v = 1.0 - sstep(1.0 - uM1.z, 1.0, dist);`,
  luminosity: `
  float L = dot(uSource.eval(p).rgb, float3(0.2126, 0.7152, 0.0722));
  float v = sstep(uM0.x - uM0.z, uM0.x, L) * (1.0 - sstep(uM0.y, uM0.y + uM0.z, L));`,
  // Max over the targets of 1 - smoothstep(0.5R, R, dE76).
  colorRange: `
  float3 lab = rgbToLab(uSource.eval(p).rgb);
  float R = uM0.x;
  float v = 0.0;
  for (int i = 0; i < 16; i++) {
    if (float(i) >= uM0.y) break;
    v = max(v, 1.0 - sstep(0.5 * R, R, length(lab - uLab[i].xyz)));
  }`,
  // Brush and subject rasters; uM0.x = subject invert.
  alpha: `
  float v = alphaAt(p / uSize);
  if (uM0.x > 0.5) v = 1.0 - v;`,
} as const;

export type MaskPassKind = keyof typeof COMPONENT_BODY;

export function maskComponentSksl(kind: MaskPassKind): string {
  return `${FOLD}\nfloat4 main(float2 p) {${COMPONENT_BODY[kind]}\n  return float4(fold(prevAt(p), v), 0.0, 0.0, 1.0);\n}\n`;
}

/** After the feather blur: invert, then the mask opacity (colorMath `finishMask`). Lazy, cheap. */
export const MASK_FINISH_SKSL = `
uniform shader uMask;
uniform float uInvert;
uniform float uOpacity;
float4 main(float2 p) {
  float m = uMask.eval(p + 0.0).r;
  m = clamp((uInvert > 0.5 ? 1.0 - m : m) * uOpacity, 0.0, 1.0);
  return float4(m, m, m, 1.0);
}
`;

/** Mask views of the selected layer's mask on straight colour (web T_MASKOVERLAY / T_MASKALPHA). uView 1 overlay, 2 alpha. */
export const MASK_VIEW_SKSL = `
uniform shader uImage;
uniform shader uMask;
uniform float uView;
float4 main(float2 p) {
  float3 c = uImage.eval(p).rgb;
  float m = uMask.eval(p).r;
  if (uView > 1.5) return float4(m, m, m, 1.0);
  return float4(mix(c, float3(1.0, 0.0, 0.0), 0.5 * (1.0 - m)), 1.0);
}
`;

/** Premultiplied source -> straight colour (opaque) or its alpha (grey), once per source. */
export const SPLIT_SKSL = `
uniform shader uImage;
uniform float uOut;
float4 main(float2 p) {
  float4 s = uImage.eval(p);
  if (uOut > 0.5) return float4(float3(s.a), 1.0);
  return float4(float3(s.a > 0.0 ? s.rgb / s.a : float3(0.0)), 1.0);
}
`;

/** Straight colour + alpha -> the premultiplied pixel the canvas draws. */
export const JOIN_SKSL = `
uniform shader uImage;
uniform shader uAlpha;
float4 main(float2 p) {
  float4 c = uImage.eval(p);
  float a = uAlpha.eval(p).r;
  return float4(float3(c.rgb * a), a);
}
`;
