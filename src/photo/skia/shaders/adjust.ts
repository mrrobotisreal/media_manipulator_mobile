/**
 * SkSL port of the web's rung-1 adjustment shader (media-manipulator-ui
 * `lib/photo/gl/shaders/adjustSource.ts`, UI commit 672037b), line for line, stage for stage, with
 * the same constant names. It mirrors `colorMath.ts` (the copied reference); the CanvasKit parity
 * test (`__tests__/skslParity.test.ts`) renders the golden docs through these sources.
 *
 * Differences from the GLSL, all mechanical (SkSL has no preprocessor, no 3D textures, no sampler
 * uniforms):
 * - one source per layer type, composed by `layerSksl(type)` (the GLSL's `#define T_<TYPE>`);
 * - textures are child shaders evaluated in pixel coordinates: `uSource`, `uMask` (always all-ones
 *   until MA51), `uCurves` (the four 256-entry curves as 16-bit values split over two bytes, one row each) and
 *   `uLut` (the byte cube as a 2D atlas of N slices); both are read with exact texel taps and
 *   interpolated in the shader like `sampleLut` / `sampleLut3D`, so no GPU filter precision and no
 *   float-texture support is involved;
 * - colours arrive premultiplied: un-premultiply, adjust, re-premultiply (alpha is never touched);
 * - `uN`, `uBlend`, `uHasMask` are floats (RN Skia packs every uniform as float).
 */
import type { LayerType } from '../../photoTypes';

/** Layer types this shader implements (= the web's `GPU_LAYER_TYPES`). */
export const SKSL_LAYER_TYPES = [
  'exposure',
  'brightnessContrast',
  'tone',
  'levels',
  'curves',
  'whiteBalance',
  'vibranceSaturation',
  'hsl',
  'colorBalance',
  'blackWhite',
  'channelMixer',
  'photoFilter',
  'splitTone',
  'lut',
  'invert',
  'posterize',
  'threshold',
  'gamma',
  'redEye',
] as const satisfies readonly LayerType[];
export type SkslLayerType = (typeof SKSL_LAYER_TYPES)[number];

export const isSkslLayerType = (t: string): t is SkslLayerType =>
  (SKSL_LAYER_TYPES as readonly string[]).includes(t);

/** Shared header: uniforms and the helpers of the GLSL (sRGB transfer, HSL, luma, range weight). */
export const COMMON_SKSL = `
uniform shader uSource;
uniform shader uMask;
uniform float4 uP[40];
uniform float uN;
uniform float uOpacity;
uniform float uBlend;
uniform float uHasMask;

const float3 LUMA = float3(0.2126, 0.7152, 0.0722);
const float3 VIBRANCE_LUMA = float3(0.072186, 0.715158, 0.212656);
const float HSL_NEUTRAL_SAT = 0.1;
const float COLOR_BALANCE_GAIN = 0.3;
const float SPLIT_TONE_GAIN = 0.25;
const float TINT_GAIN = 0.25;
const float MIN_LUMA = 0.0001;

float luma(float3 c) { return dot(c, LUMA); }
float3 clamp01(float3 c) { return clamp(c, 0.0, 1.0); }
float sstep(float e0, float e1, float x) {
  if (e1 == e0) return x < e0 ? 0.0 : 1.0;
  float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

float srgbToLinear1(float v) { return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4); }
float linearToSrgb1(float v) { return v <= 0.0031308 ? v * 12.92 : 1.055 * pow(max(v, 0.0), 1.0 / 2.4) - 0.055; }
float3 srgbToLinear(float3 v) { return float3(srgbToLinear1(v.r), srgbToLinear1(v.g), srgbToLinear1(v.b)); }
float3 linearToSrgb(float3 v) { return float3(linearToSrgb1(v.r), linearToSrgb1(v.g), linearToSrgb1(v.b)); }

float3 rgbToHsl(float3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float l = (mx + mn) * 0.5;
  float d = mx - mn;
  if (d == 0.0) return float3(0.0, 0.0, l);
  float s = d / (1.0 - abs(2.0 * l - 1.0));
  float h;
  if (mx == c.r) h = mod((c.g - c.b) / d, 6.0);
  else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
  else h = (c.r - c.g) / d + 4.0;
  h *= 60.0;
  if (h < 0.0) h += 360.0;
  return float3(h, clamp(s, 0.0, 1.0), l);
}
float3 hslToRgb(float h, float s, float l) {
  float hh = mod(mod(h, 360.0) + 360.0, 360.0) / 60.0;
  float c = (1.0 - abs(2.0 * l - 1.0)) * s;
  float x = c * (1.0 - abs(mod(hh, 2.0) - 1.0));
  float m = l - c * 0.5;
  float3 rgb;
  if (hh < 1.0) rgb = float3(c, x, 0.0);
  else if (hh < 2.0) rgb = float3(x, c, 0.0);
  else if (hh < 3.0) rgb = float3(0.0, c, x);
  else if (hh < 4.0) rgb = float3(0.0, x, c);
  else if (hh < 5.0) rgb = float3(x, 0.0, c);
  else rgb = float3(c, 0.0, x);
  return rgb + m;
}
float3 hueToRGB(float hueDeg) {
  float h = mod(mod(hueDeg, 360.0) + 360.0, 360.0) / 360.0;
  return clamp(float3(abs(h * 6.0 - 3.0) - 1.0, 2.0 - abs(h * 6.0 - 2.0), 2.0 - abs(h * 6.0 - 4.0)), 0.0, 1.0);
}
float rangeWeight(float h, float center, float width, float feather) {
  float d = abs(mod(mod(h - center, 360.0) + 540.0, 360.0) - 180.0);
  float hw = width * 0.5;
  if (d <= hw) return 1.0;
  if (feather <= 0.0 || d >= hw + feather) return 0.0;
  return 1.0 - (d - hw) / feather;
}
float levelsCh(float v, float4 a, float4 b) {
  float span = max(a.y - a.x, 0.000001);
  float t = clamp((v - a.x) / span, 0.0, 1.0);
  return clamp(pow(t, 1.0 / a.z) * (b.y - b.x) + b.x, 0.0, 1.0);
}
float3 rescaleToLuma(float3 c, float target) {
  float L = luma(c);
  if (L < MIN_LUMA) return c;
  return clamp01(c * (target / L));
}
float midtoneWeight(float3 c) {
  float l = 0.5 * (max(c.r, max(c.g, c.b)) + min(c.r, min(c.g, c.b)));
  return clamp((l - 0.333) * 4.0 + 0.5, 0.0, 1.0) * clamp((1.0 - l - 0.333) * 4.0 + 0.5, 0.0, 1.0) * 0.7;
}
`;

/** Extra declarations per type (child shaders beyond source + mask, and their uniforms). */
const EXTRA: Partial<Record<SkslLayerType, string>> = {
  curves: `
uniform shader uCurves; // 256x4 opaque RGBA8: row k = curve k (r, g, b, master) as 16-bit (hi, lo, 0)
float curveAt(float i, int ch) {
  float4 t = uCurves.eval(float2(i + 0.5, float(ch) + 0.5));
  return (floor(t.r * 255.0 + 0.5) * 256.0 + floor(t.g * 255.0 + 0.5)) / 65535.0;
}
// colorMath sampleLut: linear interpolation between the two nearest of 256 entries.
float curveSample(float v, int ch) {
  float p = clamp(v, 0.0, 1.0) * 255.0;
  float i = min(254.0, floor(p));
  return mix(curveAt(i, ch), curveAt(i + 1.0, ch), p - i);
}
`,
  lut: `
uniform shader uLut; // the byte cube as N slices of NxN (slice = blue), uLutCols slices per atlas row
uniform float uLutSize;
uniform float uLutCols;
float3 lutAt(float x, float y, float z) {
  float col = mod(z, uLutCols);
  float row = floor(z / uLutCols);
  return uLut.eval(float2(col * uLutSize + x + 0.5, row * uLutSize + y + 0.5)).rgb;
}
// colorMath sampleLut3D: trilinear from the 8 nearest entries (exact taps, no texture filtering).
float3 lut3d(float3 c) {
  float3 f = clamp01(c) * (uLutSize - 1.0);
  float3 i0 = min(float3(uLutSize - 2.0), floor(f));
  float3 t = f - i0;
  float3 c00 = mix(lutAt(i0.x, i0.y, i0.z), lutAt(i0.x + 1.0, i0.y, i0.z), t.x);
  float3 c10 = mix(lutAt(i0.x, i0.y + 1.0, i0.z), lutAt(i0.x + 1.0, i0.y + 1.0, i0.z), t.x);
  float3 c01 = mix(lutAt(i0.x, i0.y, i0.z + 1.0), lutAt(i0.x + 1.0, i0.y, i0.z + 1.0), t.x);
  float3 c11 = mix(lutAt(i0.x, i0.y + 1.0, i0.z + 1.0), lutAt(i0.x + 1.0, i0.y + 1.0, i0.z + 1.0), t.x);
  return mix(mix(c00, c10, t.y), mix(c01, c11, t.y), t.z);
}
`,
};

/** `adjust(c)` bodies, one per type: the GLSL `#ifdef T_<TYPE>` blocks. */
const BODY: Record<SkslLayerType, string> = {
  exposure: `
  float3 lin = clamp01(srgbToLinear(c) * exp2(uP[0].x) + uP[0].y);
  return clamp01(pow(linearToSrgb(lin), float3(1.0 / uP[0].z)));`,
  brightnessContrast: `
  float k = exp2(uP[0].y / 50.0);
  return clamp01((clamp01(c + uP[0].x / 200.0) - 0.5) * k + 0.5);`,
  tone: `
  float L = luma(c);
  float wSh = 1.0 - sstep(0.0, 0.6, L);
  float wHi = sstep(0.4, 1.0, L);
  float wBl = 1.0 - sstep(0.0, 0.25, L);
  float wWh = sstep(0.75, 1.0, L);
  // uP[0] = (highlights, shadows, whites, blacks)
  float dL = 0.25 * (uP[0].y / 100.0) * wSh + 0.25 * (uP[0].x / 100.0) * wHi + 0.15 * (uP[0].w / 100.0) * wBl + 0.15 * (uP[0].z / 100.0) * wWh;
  return clamp01(c * (clamp(L + dL, 0.0, 1.0) / max(L, MIN_LUMA)));`,
  levels: `
  float3 o;
  o.r = levelsCh(levelsCh(c.r, uP[2], uP[3]), uP[0], uP[1]);
  o.g = levelsCh(levelsCh(c.g, uP[4], uP[5]), uP[0], uP[1]);
  o.b = levelsCh(levelsCh(c.b, uP[6], uP[7]), uP[0], uP[1]);
  return o;`,
  curves: `
  return float3(curveSample(curveSample(c.r, 0), 3), curveSample(curveSample(c.g, 1), 3), curveSample(curveSample(c.b, 2), 3));`,
  whiteBalance: `
  float3 lin = srgbToLinear(c);
  float t = uP[0].x / 100.0;
  float ti = uP[0].y / 100.0;
  float w = midtoneWeight(lin);
  float3 sh = clamp01(lin + float3(t, -ti, -t) * w);
  return clamp01(linearToSrgb(sh));`,
  vibranceSaturation: `
  float i = uP[0].x / 100.0;
  float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  float lv = dot(c, VIBRANCE_LUMA);
  float f = 1.0 + i * (1.0 - sign(i) * sat);
  float3 v = clamp01(lv + (c - lv) * f);
  float le = luma(v);
  float nl = (le - 0.5) * 1.0 + 0.5;
  return clamp01(nl + (v - le) * (1.0 + uP[0].y / 100.0));`,
  hsl: `
  float3 hsl = rgbToHsl(c);
  float neutral = min(1.0, hsl.y / HSL_NEUTRAL_SAT);
  float dh = uP[0].x;
  float sMul = 1.0 + uP[0].y / 100.0;
  float dl0 = uP[0].z / 100.0;
  float lPos = max(dl0, 0.0);
  float lNeg = min(dl0, 0.0);
  for (int i = 0; i < 16; i++) {
    if (float(i) >= uN) break;
    float4 a = uP[1 + 2 * i];
    float4 b = uP[2 + 2 * i];
    float w = rangeWeight(hsl.x, a.x, a.y, a.z) * neutral;
    if (w == 0.0) continue;
    dh += w * a.w;
    sMul *= 1.0 + w * b.x / 100.0;
    float dlr = w * b.y / 100.0;
    if (dlr > 0.0) lPos += dlr; else lNeg += dlr;
  }
  float s2 = clamp(hsl.y * sMul, 0.0, 1.0);
  float l2 = clamp(hsl.z + lPos * (1.0 - hsl.z) + lNeg * hsl.z, 0.0, 1.0);
  return clamp01(hslToRgb(hsl.x + dh, s2, l2));`,
  colorBalance: `
  float L = luma(c);
  float wSh = 1.0 - sstep(0.0, 0.5, L);
  float wMid = midtoneWeight(c);
  float wHi = sstep(0.5, 1.0, L);
  float3 add = COLOR_BALANCE_GAIN * ((wSh * uP[0].rgb + wMid * uP[1].rgb + wHi * uP[2].rgb) / 100.0);
  float3 o = clamp01(c + add);
  return uP[3].x > 0.5 ? rescaleToLuma(o, L) : o;`,
  blackWhite: `
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float S = mx == 0.0 ? 0.0 : (mx - mn) / mx;
  float V = mx;
  float h = rgbToHsl(c).x;
  float L = luma(c);
  float mixv = 0.0;
  mixv += rangeWeight(h, 0.0, 30.0, 30.0) * (uP[0].x / 100.0);
  mixv += rangeWeight(h, 60.0, 30.0, 30.0) * (uP[0].y / 100.0);
  mixv += rangeWeight(h, 120.0, 30.0, 30.0) * (uP[0].z / 100.0);
  mixv += rangeWeight(h, 180.0, 30.0, 30.0) * (uP[0].w / 100.0);
  mixv += rangeWeight(h, 240.0, 30.0, 30.0) * (uP[1].x / 100.0);
  mixv += rangeWeight(h, 300.0, 30.0, 30.0) * (uP[1].y / 100.0);
  float gray = clamp((1.0 - S) * L + S * mixv * V, 0.0, 1.0);
  if (uP[1].z < 0.5) return float3(gray);
  float ta = (uP[2].x / 100.0) * TINT_GAIN;
  return clamp01(float3(gray) + ta * (hueToRGB(uP[1].w) - 0.5));`,
  channelMixer: `
  float r = clamp((uP[0].x * c.r + uP[0].y * c.g + uP[0].z * c.b + uP[0].w) / 100.0, 0.0, 1.0);
  if (uP[3].x > 0.5) return float3(r);
  float g = clamp((uP[1].x * c.r + uP[1].y * c.g + uP[1].z * c.b + uP[1].w) / 100.0, 0.0, 1.0);
  float b = clamp((uP[2].x * c.r + uP[2].y * c.g + uP[2].z * c.b + uP[2].w) / 100.0, 0.0, 1.0);
  return float3(r, g, b);`,
  photoFilter: `
  float3 o = mix(c, c * uP[0].rgb, uP[0].w);
  return uP[1].x > 0.5 ? rescaleToLuma(o, luma(c)) : o;`,
  splitTone: `
  float L = luma(c);
  float e = 0.5 + (uP[1].x / 100.0) * 0.25;
  float wSh = 1.0 - sstep(0.0, e, L);
  float wHi = sstep(e, 1.0, L);
  float3 sa = SPLIT_TONE_GAIN * (uP[0].y / 100.0) * wSh * (hueToRGB(uP[0].x) - 0.5);
  float3 hb = SPLIT_TONE_GAIN * (uP[0].w / 100.0) * wHi * (hueToRGB(uP[0].z) - 0.5);
  return clamp01(c + sa + hb);`,
  lut: `
  if (uLutSize < 2.0) return c;
  return mix(c, lut3d(c), uP[0].x);`,
  invert: `
  return 1.0 - c;`,
  posterize: `
  float n = uP[0].x - 1.0;
  return floor(clamp01(c) * n + 0.5) / n;`,
  threshold: `
  return float3(luma(c) >= uP[0].x ? 1.0 : 0.0);`,
  gamma: `
  return clamp01(pow(clamp01(c), float3(1.0 / uP[0].x)));`,
  redEye: `
  return float3(min(c.r, (c.g + c.b) * 0.5), c.g, c.b);`,
};

const MAIN = `
float4 main(float2 p) {
  float4 src = uSource.eval(p);
  float alpha = src.a;
  float3 c = alpha > 0.0 ? src.rgb / alpha : float3(0.0);
  float3 o = adjust(c);
  if (uBlend > 1.5) {
    o = clamp01(o + (luma(c) - luma(o)));
  } else if (uBlend > 0.5) {
    o = clamp01(c + (luma(o) - luma(c)));
  }
  float mv = uHasMask > 0.5 ? uMask.eval(p).r : 1.0;
  o = mix(c, o, clamp(uOpacity * mv, 0.0, 1.0));
  return float4(o * alpha, alpha);
}
`;

/** The full SkSL source for one layer type. */
export function layerSksl(type: SkslLayerType): string {
  return `${COMMON_SKSL}${EXTRA[type] ?? ''}\nfloat3 adjust(float3 c) {${BODY[type]}\n}\n${MAIN}`;
}

/** Child shader order for `makeShaderWithChildren` (= declaration order in the source). */
export function childNames(type: SkslLayerType): string[] {
  if (type === 'curves') return ['uSource', 'uMask', 'uCurves'];
  if (type === 'lut') return ['uSource', 'uMask', 'uLut'];
  return ['uSource', 'uMask'];
}
