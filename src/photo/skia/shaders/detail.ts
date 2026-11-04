/**
 * SkSL port of the web's rung-4 detail passes (media-manipulator-ui
 * `lib/photo/gl/shaders/detailSource.ts`, UI main 615d7c0), pass for pass, with the constants of
 * `colorMath.ts` "Detail". `pipeline.ts` sequences them like the web's `runDetail`:
 *
 * - sharpen / clarity / texture: `GAUSS_H` (luma, packed to 16 bits) then `UNSHARP_V` (vertical + unsharp + tail);
 * - blur: `GAUSS_H` (rgb) then `BLUR_V` (+ tail);
 * - noise reduction: `NR_L` / `NR_AB` (Lab, 16 / 12 + 12 bits), `NR_BIL` (9x9 bilateral on L),
 *   `NR_AB_H` (horizontal chroma), `NR_FIN` (vertical chroma, Lab -> RGB, tail);
 * - dehaze: `DARK_H`, `DARK_V` (sampled on a grid for the 99.5th percentile), `DEHAZE` (+ tail);
 * - vignette: `VIGNETTE`; grain: `GRAIN` (both per pixel, no materialised input).
 *
 * Every final pass reads the ORIGINAL input in `uSource` and applies blend / opacity / mask like
 * `mixLayer` (`tail`). Pixel (x, y) = floor(p).
 *
 * Differences from the GLSL, all mechanical: SkSL runtime effects have no unsigned integers and
 * no `^`, `>>`, `%` (checked on CanvasKit), so the grain's 32-bit PCG hash runs on four 8-bit
 * limbs held in floats (every intermediate < 2^24, so it is exact on every backend; the parity
 * test checks it bit for bit against `colorMath.grainHash`); the separable Gaussian's loop breaks
 * at 2r+1 taps instead of skipping up to MAX_TAPS (same taps, same order).
 */
import { GRAIN_SALT, GRAIN_Y_OFFSET } from '../../colorMath';

/** Children: uSource (input), uPrev (previous pass), uMask; the shared helpers and the blend tail. */
const HEADER = `
uniform shader uSource;
uniform shader uPrev;
uniform shader uMask;
uniform shader uAux;
uniform float2 uSize;
uniform float uOpacity;
uniform float uBlend;
uniform float uHasMask;

const float3 LUMA = float3(0.2126, 0.7152, 0.0722);
const int MAX_TAPS = 801;

float2 px(float2 p) { return floor(p); }
float4 src(float2 q) { return uSource.eval(clamp(q, float2(0.0), uSize - 1.0) + 0.5); }
float4 prv(float2 q) { return uPrev.eval(clamp(q, float2(0.0), uSize - 1.0) + 0.5); }
float4 aux(float2 q) { return uAux.eval(clamp(q, float2(0.0), uSize - 1.0) + 0.5); }
float bq(float v) { return floor(v * 255.0 + 0.5); }
// Intermediates live in opaque RGBA8 rasters: a 0..1 value as 16 bits over (r, g), and the Lab
// chroma pair as 12 + 12 bits over (r, g, b) (a, b in -128..128). The web uses half floats.
float4 pack16(float v) {
  float u = floor(clamp(v, 0.0, 1.0) * 65535.0 + 0.5);
  float hi = floor(u / 256.0);
  return float4(hi / 255.0, (u - hi * 256.0) / 255.0, 0.0, 1.0);
}
float unpack16(float4 t) { return (bq(t.r) * 256.0 + bq(t.g)) / 65535.0; }
float4 packAB(float2 ab) {
  float2 u = floor(clamp(ab / 256.0 + 0.5, 0.0, 1.0) * 4095.0 + 0.5);
  float ah = floor(u.x / 16.0);
  float bh = floor(u.y / 256.0);
  return float4(ah / 255.0, ((u.x - ah * 16.0) * 16.0 + bh) / 255.0, (u.y - bh * 256.0) / 255.0, 1.0);
}
float2 unpackAB(float4 t) {
  float g = bq(t.g);
  float al = floor(g / 16.0);
  float2 u = float2(bq(t.r) * 16.0 + al, (g - al * 16.0) * 256.0 + bq(t.b));
  return (u / 4095.0 - 0.5) * 256.0;
}
float luma(float3 c) { return dot(c, LUMA); }
float3 clamp01(float3 c) { return clamp(c, 0.0, 1.0); }
float sstep(float e0, float e1, float x) {
  if (e1 == e0) return x < e0 ? 0.0 : 1.0;
  float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
// Blend (normal / luminosity / color), opacity and the layer mask, like mixLayer. Opaque out.
float4 tail(float2 p, float3 c, float3 a) {
  if (uBlend > 1.5) a = clamp01(a + (luma(c) - luma(a)));
  else if (uBlend > 0.5) a = clamp01(c + (luma(a) - luma(c)));
  float mv = uHasMask > 0.5 ? uMask.eval(p).r : 1.0;
  return float4(mix(c, a, clamp(uOpacity * mv, 0.0, 1.0)), 1.0);
}
`;

const LAB = `
float3 srgbToLinear(float3 v) {
  return mix(pow((max(v, 0.0) + 0.055) / 1.055, float3(2.4)), v / 12.92, step(v, float3(0.04045)));
}
float3 linearToSrgb(float3 v) {
  return mix(1.055 * pow(max(v, 0.0), float3(1.0 / 2.4)) - 0.055, v * 12.92, step(v, float3(0.0031308)));
}
float labF(float t) { return t > 216.0 / 24389.0 ? pow(t, 1.0 / 3.0) : (24389.0 / 27.0 * t + 16.0) / 116.0; }
float3 rgbToLab(float3 c) {
  float3 l = srgbToLinear(c);
  float x = (0.4124564 * l.r + 0.3575761 * l.g + 0.1804375 * l.b) / 0.95047;
  float y = 0.2126729 * l.r + 0.7151522 * l.g + 0.072175 * l.b;
  float z = (0.0193339 * l.r + 0.119192 * l.g + 0.9503041 * l.b) / 1.08883;
  float fx = labF(x);
  float fy = labF(y);
  float fz = labF(z);
  return float3(116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz));
}
float labFinv(float f) { return f > 6.0 / 29.0 ? f * f * f : (116.0 * f - 16.0) * 27.0 / 24389.0; }
float3 labToRgb(float3 lab) {
  float fy = (lab.x + 16.0) / 116.0;
  float fx = fy + lab.y / 500.0;
  float fz = fy - lab.z / 200.0;
  float x = labFinv(fx) * 0.95047;
  float y = labFinv(fy);
  float z = labFinv(fz) * 1.08883;
  float3 lin = float3(3.2404542 * x - 1.5371385 * y - 0.4985314 * z, -0.969266 * x + 1.8760108 * y + 0.041556 * z, 0.0556434 * x - 0.2040259 * y + 1.0572252 * z);
  return clamp01(linearToSrgb(clamp01(lin)));
}
`;

/** Separable Gaussian along uDir with sigma uSigma (taps normalised on the fly, edges replicated). */
const GAUSS = `
uniform float2 uDir;
// The blurred luma travels between passes packed to 16 bits (the unsharp gain multiplies an
// 8-bit error by up to 5).
uniform float uSigma;
float4 gauss(float2 p, float mode) {
  float r = ceil(3.0 * uSigma);
  float wsum = 0.0;
  float4 acc = float4(0.0);
  for (int i = 0; i < MAX_TAPS; i++) {
    float k = float(i) - r;
    if (k > r) break;
    float wk = exp(-(k * k) / (2.0 * uSigma * uSigma));
    float2 q = p + uDir * k;
    if (mode < 0.5) acc += wk * float4(luma(src(q).rgb), 0.0, 0.0, 0.0);
    else if (mode < 1.5) acc += wk * src(q);
    else if (mode < 2.5) acc += wk * prv(q);
    else acc += wk * float4(unpack16(prv(q)), 0.0, 0.0, 0.0);
    wsum += wk;
  }
  return acc / wsum;
}
`;

/** uP[0] = (gain, midWeight 0/1, threshold, 0). */
const PARAMS = `uniform float4 uP0;\nuniform float4 uP1;\n`;

function hexBytes(v: number): string {
  const u = v >>> 0;
  return `float4(${u & 255}.0, ${(u >>> 8) & 255}.0, ${(u >>> 16) & 255}.0, ${(u >>> 24) & 255}.0)`;
}

/**
 * 32-bit unsigned arithmetic on four 8-bit limbs (x = low byte), floats only. Mirrors
 * `colorMath.pcgHash` / `grainHash` exactly: multiply mod 2^32, add, xor, logical shift right.
 */
export const U32_SKSL = `
float4 u32carry(float4 r) {
  float c = floor(r.x / 256.0); r.x -= c * 256.0; r.y += c;
  c = floor(r.y / 256.0); r.y -= c * 256.0; r.z += c;
  c = floor(r.z / 256.0); r.z -= c * 256.0; r.w += c;
  r.w -= floor(r.w / 256.0) * 256.0;
  return r;
}
float4 u32mul(float4 a, float4 b) {
  return u32carry(float4(
    a.x * b.x,
    a.x * b.y + a.y * b.x,
    a.x * b.z + a.y * b.y + a.z * b.x,
    a.x * b.w + a.y * b.z + a.z * b.y + a.w * b.x));
}
float4 u32add(float4 a, float4 b) { return u32carry(a + b); }
float xor8(float a, float b) {
  float r = 0.0;
  float bit = 1.0;
  for (int i = 0; i < 8; i++) {
    float ha = floor(a / 2.0);
    float hb = floor(b / 2.0);
    r += bit * abs((a - 2.0 * ha) - (b - 2.0 * hb));
    a = ha;
    b = hb;
    bit *= 2.0;
  }
  return r;
}
float4 u32xor(float4 a, float4 b) { return float4(xor8(a.x, b.x), xor8(a.y, b.y), xor8(a.z, b.z), xor8(a.w, b.w)); }
float4 u32shr(float4 a, float n) {
  float q = floor(n / 8.0);
  float r = n - q * 8.0;
  for (int i = 0; i < 3; i++) {
    if (float(i) < q) a = float4(a.y, a.z, a.w, 0.0);
  }
  float d = 1.0;
  for (int i = 0; i < 7; i++) {
    if (float(i) < r) d *= 2.0;
  }
  float m = 256.0 / d;
  return float4(
    floor(a.x / d) + (a.y - floor(a.y / d) * d) * m,
    floor(a.y / d) + (a.z - floor(a.z / d) * d) * m,
    floor(a.z / d) + (a.w - floor(a.w / d) * d) * m,
    floor(a.w / d));
}
float4 u32of(float v) {
  float4 r = float4(0.0);
  r.w = floor(v / 16777216.0); v -= r.w * 16777216.0;
  r.z = floor(v / 65536.0); v -= r.z * 65536.0;
  r.y = floor(v / 256.0);
  r.x = v - r.y * 256.0;
  return r;
}
float4 pcg(float4 v) {
  float4 s = u32add(u32mul(v, ${hexBytes(747796405)}), ${hexBytes(2891336453)});
  float4 w = u32mul(u32xor(u32shr(s, floor(s.w / 16.0) + 4.0), s), ${hexBytes(277803737)});
  return u32xor(u32shr(w, 22.0), w);
}
// pcg(pcg(x ^ seed) ^ (y + 0x9E3779B9)); x, y small non-negative integers, seed as limbs.
float4 grainHash(float x, float y, float4 seed) {
  return pcg(u32xor(pcg(u32xor(u32of(x), seed)), u32add(u32of(y), ${hexBytes(GRAIN_Y_OFFSET)})));
}
float u32unit(float4 h) { return ((h.w * 256.0 + h.z) * 256.0 + h.y) / 16777216.0 + h.x / 4294967296.0; }
`;

const BODY = {
  // uMode 0: luma of uSource, packed to 16 bits; 1: rgb of uSource.
  GAUSS_H: `${GAUSS}uniform float uMode;
float4 main(float2 p) {
  float4 g = gauss(px(p), uMode);
  return uMode < 0.5 ? pack16(g.r) : float4(g.rgb, 1.0);
}`,
  // Plain vertical Gaussian of uPrev (the mask feather's second pass).
  GAUSS_V: `${GAUSS}
float4 main(float2 p) {
  return float4(gauss(px(p), 2.0).rgb, 1.0);
}`,
  UNSHARP_V: `${GAUSS}${PARAMS}
float4 main(float2 p) {
  float3 c = uSource.eval(p).rgb;
  float lb = gauss(px(p), 3.0).r;
  float L = luma(c);
  float d = L - lb;
  if (uP0.z > 0.0 && !(abs(d) > uP0.z)) d = 0.0;
  float wt = uP0.y > 0.5 ? 1.0 - abs(2.0 * L - 1.0) : 1.0;
  return tail(p, c, clamp01(c + uP0.x * d * wt));
}`,
  BLUR_V: `${GAUSS}
float4 main(float2 p) {
  float3 c = uSource.eval(p).rgb;
  return tail(p, c, clamp01(gauss(px(p), 2.0).rgb));
}`,
  // Lab L/100 of the input, 16 bits.
  NR_L: `${LAB}
float4 main(float2 p) {
  return pack16(rgbToLab(src(px(p)).rgb).x / 100.0);
}`,
  // Lab (a, b) of the input, 12 + 12 bits.
  NR_AB: `${LAB}
float4 main(float2 p) {
  return packAB(rgbToLab(src(px(p)).rgb).yz);
}`,
  // uSource = NR_L. 9x9 bilateral (uP0 = (sigmaS, sigmaR, chromaSigma, doLuma)), 16 bits out.
  NR_BIL: `${PARAMS}
float4 main(float2 p) {
  float2 q0 = px(p);
  float lc = unpack16(src(q0));
  if (uP0.w < 0.5) return pack16(lc);
  float inv2r = 1.0 / (2.0 * uP0.y * uP0.y);
  float inv2s = 1.0 / (2.0 * uP0.x * uP0.x);
  float lacc = 0.0;
  float lw = 0.0;
  for (int dy = -4; dy <= 4; dy++) {
    for (int dx = -4; dx <= 4; dx++) {
      float q = unpack16(src(q0 + float2(float(dx), float(dy))));
      float wt = exp(-float(dx * dx + dy * dy) * inv2s) * exp(-(q - lc) * (q - lc) * inv2r);
      lacc += wt * q;
      lw += wt;
    }
  }
  return pack16(lacc / lw);
}`,
  // uSource = NR_AB. Horizontal Gaussian of the chroma (uP0.z = sigma), 12 + 12 bits out.
  NR_AB_H: `${PARAMS}
float4 main(float2 p) {
  float2 q0 = px(p);
  if (uP0.z < 1e-3) return src(q0);
  float rr = ceil(3.0 * uP0.z);
  float wsum = 0.0;
  float2 cacc = float2(0.0);
  for (int i = 0; i < MAX_TAPS; i++) {
    float k = float(i) - rr;
    if (k > rr) break;
    float wk = exp(-(k * k) / (2.0 * uP0.z * uP0.z));
    cacc += wk * unpackAB(src(q0 + float2(k, 0.0)));
    wsum += wk;
  }
  return packAB(cacc / wsum);
}`,
  // uSource = original, uPrev = NR_BIL (L), uAux = NR_AB_H; vertical chroma Gaussian, Lab -> RGB, tail.
  NR_FIN: `${LAB}${PARAMS}
float4 main(float2 p) {
  float2 q0 = px(p);
  float3 c = uSource.eval(p).rgb;
  float L = unpack16(prv(q0)) * 100.0;
  float2 ab2 = unpackAB(aux(q0));
  if (uP0.z >= 1e-3) {
    float rr = ceil(3.0 * uP0.z);
    float wsum = 0.0;
    float2 cacc = float2(0.0);
    for (int i = 0; i < MAX_TAPS; i++) {
      float k = float(i) - rr;
      if (k > rr) break;
      float wk = exp(-(k * k) / (2.0 * uP0.z * uP0.z));
      cacc += wk * unpackAB(aux(q0 + float2(0.0, k)));
      wsum += wk;
    }
    ab2 = cacc / wsum;
  }
  return tail(p, c, labToRgb(float3(L, ab2)));
}`,
  // 15-wide clipped-window min of min(r, g, b), horizontal.
  DARK_H: `
float4 main(float2 p) {
  float2 q0 = px(p);
  float mn = 1.0;
  for (int k = -7; k <= 7; k++) {
    float x = q0.x + float(k);
    if (x < 0.0 || x >= uSize.x) continue;
    float3 t = src(float2(x, q0.y)).rgb;
    mn = min(mn, min(t.r, min(t.g, t.b)));
  }
  return float4(mn, mn, mn, 1.0);
}`,
  // Vertical clipped min of DARK_H (uPrev). uP0.xy = image pixels per output pixel (grid sampling).
  DARK_V: `${PARAMS}
float4 main(float2 p) {
  float2 q0 = floor((floor(p) + 0.5) * uP0.xy);
  float mn = 1.0;
  for (int k = -7; k <= 7; k++) {
    float y = q0.y + float(k);
    if (y < 0.0 || y >= uSize.y) continue;
    mn = min(mn, prv(float2(q0.x, y)).r);
  }
  return float4(mn, mn, mn, 1.0);
}`,
  // uSource = original, uPrev = DARK_H; uP0 = (amount -1..1, A, 0, 0).
  DEHAZE: `${PARAMS}
float4 main(float2 p) {
  float2 q0 = px(p);
  float3 c = uSource.eval(p).rgb;
  float dark = 1.0;
  for (int k = -7; k <= 7; k++) {
    float y = q0.y + float(k);
    if (y < 0.0 || y >= uSize.y) continue;
    dark = min(dark, prv(float2(q0.x, y)).r);
  }
  float amt = uP0.x;
  float A = uP0.y;
  float3 a2 = c;
  if (amt > 0.0) {
    float t = max(1.0 - 0.95 * (dark / A), 0.1);
    a2 = c + (clamp01((c - A) / t + A) - c) * amt;
  } else if (amt < 0.0) {
    float k = -amt * 0.5;
    a2 = clamp01(c * (1.0 - k) + A * k);
  }
  return tail(p, c, a2);
}`,
  // uP0 = (amount, midpoint, roundness, feather), uP1.x = highlights (all /100).
  VIGNETTE: `${PARAMS}
float4 main(float2 p) {
  float3 c = uSource.eval(p).rgb;
  float2 n = (px(p) + 0.5) / uSize * 2.0 - 1.0;
  float rect = max(abs(n.x), abs(n.y));
  float circ = length(n * uSize * 0.5) / length(uSize * 0.5);
  float rd = (uP0.z * 100.0 + 100.0) / 200.0;
  float dist = rect * (1.0 - rd) + circ * rd;
  float v = sstep(uP0.y, uP0.y + uP0.w, dist);
  float amount = uP0.x;
  float prot = amount < 0.0 ? 1.0 - uP1.x * luma(c) : 1.0;
  return tail(p, c, clamp01(c * (1.0 + amount * v * prot)));
}`,
  // uP0 = (amount/100, size, roughness/100, 0); uSeed / uSeed2 = seed and seed ^ GRAIN_SALT as limbs.
  GRAIN: `${PARAMS}
uniform float4 uSeed;
uniform float4 uSeed2;
${U32_SKSL}
float4 main(float2 p) {
  float3 c = uSource.eval(p).rgb;
  float2 q = px(p);
  float sz = max(1.0, floor(uP0.y));
  float n1 = u32unit(grainHash(floor(q.x / sz), floor(q.y / sz), uSeed));
  float rq = uP0.z * 0.5;
  float nn = n1;
  if (rq > 0.0) {
    float n2 = u32unit(grainHash(q.x, q.y, uSeed2));
    nn = n1 * (1.0 - rq) + n2 * rq;
  }
  return tail(p, c, clamp01(c + uP0.x * 0.2 * (nn - 0.5)));
}`,
} as const;

export type DetailPass = keyof typeof BODY;

export function detailSksl(pass: DetailPass): string {
  return `${HEADER}${BODY[pass]}\n`;
}

/**
 * Test seam: the grain hash alone. Pixel (2x, y) carries limbs 0..2 of grainHash(x, y, seed) in
 * r, g, b and pixel (2x + 1, y) limb 3 in r (alpha stays 1 so readback is exact).
 */
export const GRAIN_HASH_PROBE_SKSL = `
uniform float4 uSeed;
${U32_SKSL}
float4 main(float2 p) {
  float x = floor(p.x / 2.0);
  float4 h = grainHash(x, floor(p.y), uSeed);
  if (floor(p.x) - 2.0 * x > 0.5) return float4(h.w / 255.0, 0.0, 0.0, 1.0);
  return float4(h.xyz / 255.0, 1.0);
}
`;

/** A 32-bit seed as the four 8-bit limbs the shaders take (x = low byte). */
export const seedLimbs = (seed: number): number[] => {
  const u = seed >>> 0;
  return [u & 255, (u >>> 8) & 255, (u >>> 16) & 255, (u >>> 24) & 255];
};
export const saltedSeed = (seed: number): number => ((seed >>> 0) ^ GRAIN_SALT) >>> 0;
