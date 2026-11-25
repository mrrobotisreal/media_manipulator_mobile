// DO NOT EDIT. Copied from media-manipulator-ui lib/studio/glCompositor.ts by scripts/sync-studio.mjs
// (npm run studio:sync). The web repo is the source of the Darkroom model and math (ADR MA-0012);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
import type { ParsedLut } from '../../photo/studioLutParser';
import type { StudioBlendMode } from '../studioTypes';

/**
 * GLCompositor — the accurate Content Studio preview. The pooled <video>
 * elements stay as decoders (seek/clock machinery lives in preview-surface.tsx);
 * this class replaces the visual layer with a single WebGL2 canvas that
 * composites them, matching the server export math.
 *
 * SHARED TRANSFORM SPEC (mirror this verbatim in internal/services/studio_export.go):
 *   Given source (srcW,srcH), crop (cl,ct,cr,cb), output (W,H), transform
 *   {x,y,scale,rotationDeg}, alpha = opacity*dissolve:
 *     1. Crop: sample UV u∈[cl,1-cr], v∈[ct,1-cb]; croppedW=srcW*(1-cl-cr),
 *        croppedH=srcH*(1-ct-cb).
 *     2. Fit cropped into a box (W*scale × H*scale), aspect-preserving
 *        (force_original_aspect_ratio=decrease):
 *        fit = min(W*scale/croppedW, H*scale/croppedH); drawW=croppedW*fit,
 *        drawH=croppedH*fit.
 *     3. Center then offset (pixel space, y-down): cx=W/2+x*W, cy=H/2+y*H.
 *     4. Rotate the quad clockwise by rotationDeg about (cx,cy).
 *   Fragment order mirrors the export chain: eq → lumetri → lut → chromakey →
 *   alpha → blend(backdrop).
 *
 * ALPHA MODEL: the pipeline works in STRAIGHT (non-premultiplied) RGB. The
 * separable blend equations are defined on straight color, and the composite
 * base is opaque black, so this is exact. (The context is alpha:false; canvas
 * compositing with the page never sees our internal alpha.)
 *
 * BLEND SPEC (part 12 parity closure — both sides state this one semantic):
 *   out = mix(backdrop, blendRGB(backdrop, src), layerAlpha)
 * where layerAlpha = srcTextureAlpha × clipOpacity(×dissolve) × chromaKeyAlpha
 * and blendRGB is per-RGB-channel (ffmpeg vf_blend on gbrp; `overlay` mode
 * conditions on the backdrop). The export graph computes exactly this via
 * gbrp blend + alphamerge + straight-alpha overlay (compositeStep in
 * studio_export.go); LUT intensity is the same linear mix(c, graded, i) on
 * both sides.
 */

export interface GLTransform {
  x: number;
  y: number;
  scale: number;
  rotationDeg: number;
}
export interface GLCrop {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface GLEq {
  brightness: number;
  contrast: number;
  saturation: number;
}
export interface GLLumetri {
  exposure: number;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
  vibrance: number;
}
export interface GLChroma {
  keyColor: [number, number, number]; // 0..1 rgb
  similarity: number;
  blend: number;
  despill: number;
}
export interface GLLayer {
  slot: number; // pool slot → source texture (-1 for solid layers)
  srcW: number;
  srcH: number;
  transform?: GLTransform;
  crop?: GLCrop;
  opacity: number; // already × transition alpha
  blendMode?: StudioBlendMode;
  eq?: GLEq;
  lumetri?: GLLumetri;
  lut?: { key: string; intensity: number };
  chroma?: GLChroma;
  /**
   * Solid color layer (part 14 dip transitions): no texture sample, the quad is
   * filled with this straight RGB (0..1). Set srcW/srcH to the project size so
   * the quad covers the full canvas; `slot` is ignored.
   */
  solid?: [number, number, number];
  /**
   * Canvas-space wipe mask (part 14 wipe transitions): fractions of the OUTPUT
   * frame hidden from each edge, applied after all effects (alpha → 0 outside
   * the revealed region). Mirrors the export's animated crop on the clip.
   */
  wipe?: { left: number; top: number; right: number; bottom: number };
  /**
   * Static-image source (part 16 title clips): sample the texture uploaded via
   * uploadImage() under this id instead of a pool slot. `slot` is ignored.
   */
  imageKey?: string;
}

const BLEND_INDEX: Record<StudioBlendMode, number> = {
  normal: 0,
  multiply: 1,
  screen: 2,
  overlay: 3,
  lighten: 4,
  darken: 5,
  addition: 6,
  difference: 7,
};

const MAX_BACKING_DIM = 1920; // cap FBO size for 4K projects (perf; Safari texImage2D)

const VERT_SRC = `#version 300 es
in vec2 aPos;
in vec2 aUV;
out vec2 vUV;
void main() {
  vUV = aUV;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG_SRC = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uSource;
uniform sampler2D uBackdrop;
uniform sampler3D uLut;
uniform vec2 uOutSize;
uniform float uOpacity;
uniform int uBlendMode;

uniform int uHasEq;
uniform vec3 uEq; // brightness, contrast, saturation

uniform int uHasLumetri;
uniform float uExposure, uLumContrast, uLumSaturation, uTemperature, uTint, uVibrance;

uniform int uHasLut;
uniform float uLutIntensity;

uniform int uHasChroma;
uniform vec3 uKeyColor;
uniform float uSimilarity, uChromaBlend, uDespill;

uniform int uHasSolid;
uniform vec3 uSolidColor;

uniform int uHasWipe;
uniform vec4 uWipe; // left, top, right, bottom — canvas fractions hidden

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
// vf_vibrance's luma coefficients as applied to (r,g,b) — its rc/bc weights are
// swapped vs BT.709; we mirror the filter, not the standard.
const vec3 VIB_LUMA = vec3(0.072186, 0.715158, 0.212656);

// applyEqCS mirrors ffmpeg's eq filter (contrast/saturation stage shared by the
// legacy adjustments and the lumetri tail): contrast scales LUMA about 0.5
// (+brightness), saturation scales chroma independently of contrast — eq gives
// the chroma planes contrast=saturation, untouched by the luma contrast.
vec3 applyEqCS(vec3 c, float brightness, float contrast, float saturation) {
  float l = dot(c, LUMA);
  float nl = (l - 0.5) * contrast + 0.5 + brightness;
  return clamp(vec3(nl) + (c - vec3(l)) * saturation, 0.0, 1.0);
}

vec3 applyEq(vec3 c) {
  return applyEqCS(c, uEq.x, uEq.y, uEq.z);
}

// applyLumetri mirrors the export chain (lumetriArgs in studio_export.go)
// stage-for-stage, clamping between stages like each 8-bit ffmpeg filter:
//   colorchannelmixer(2^exposure) → colorbalance(midtones) → vibrance → eq.
// Reference TS implementation with unit tests: lib/studio/colorMath.ts.
vec3 applyLumetri(vec3 c) {
  c = clamp(c * exp2(uExposure), 0.0, 1.0);
  // colorbalance midtones (vf_colorbalance get_component): lightness =
  // (max+min)/2, weight = clip((l-1/3)*4+.5)*clip((1-l-1/3)*4+.5)*0.7, then
  // rm=+temp/100, gm=-tint/100, bm=-temp/100 added under that weight.
  float t = uTemperature / 100.0;
  float ti = uTint / 100.0;
  float cbl = 0.5 * (max(c.r, max(c.g, c.b)) + min(c.r, min(c.g, c.b)));
  float w = clamp((cbl - 0.333) * 4.0 + 0.5, 0.0, 1.0)
          * clamp((1.0 - cbl - 0.333) * 4.0 + 0.5, 0.0, 1.0) * 0.7;
  c = clamp(c + vec3(t, -ti, -t) * w, 0.0, 1.0);
  // vibrance (vf_vibrance, balance=1): factor 1 + i*(1 - sign(i)*(max-min)),
  // lerp from its luma per channel.
  float vsat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  float vl = dot(c, VIB_LUMA);
  float vf = 1.0 + uVibrance * (1.0 - sign(uVibrance) * vsat);
  c = clamp(mix(vec3(vl), c, vf), 0.0, 1.0);
  return applyEqCS(c, 0.0, uLumContrast, uLumSaturation);
}

vec2 toUV(vec3 c) {
  return vec2(dot(c, vec3(-0.169, -0.331, 0.5)), dot(c, vec3(0.5, -0.419, -0.081)));
}

vec3 blendRGB(vec3 b, vec3 s) {
  if (uBlendMode == 1) return b * s;
  if (uBlendMode == 2) return 1.0 - (1.0 - b) * (1.0 - s);
  if (uBlendMode == 3) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
  if (uBlendMode == 4) return max(b, s);
  if (uBlendMode == 5) return min(b, s);
  if (uBlendMode == 6) return min(b + s, vec3(1.0));
  if (uBlendMode == 7) return abs(b - s);
  return s;
}

void main() {
  vec4 src = texture(uSource, vUV);
  vec3 c = uHasSolid == 1 ? uSolidColor : src.rgb;
  float a = (uHasSolid == 1 ? 1.0 : src.a) * uOpacity;
  if (uHasWipe == 1) {
    // Canvas-space reveal mask (top-left origin; gl_FragCoord is bottom-up).
    vec2 tl = vec2(gl_FragCoord.x / uOutSize.x, 1.0 - gl_FragCoord.y / uOutSize.y);
    if (tl.x < uWipe.x || tl.x > 1.0 - uWipe.z || tl.y < uWipe.y || tl.y > 1.0 - uWipe.w) {
      a = 0.0;
    }
  }
  if (uHasEq == 1) c = applyEq(c);
  if (uHasLumetri == 1) c = applyLumetri(c);
  if (uHasLut == 1) {
    vec3 g = texture(uLut, clamp(c, 0.0, 1.0)).rgb;
    c = mix(c, g, uLutIntensity);
  }
  if (uHasChroma == 1) {
    float d = distance(toUV(c), toUV(uKeyColor));
    float ca = smoothstep(uSimilarity, uSimilarity + uChromaBlend + 1e-4, d);
    a *= ca;
    c.g = mix(c.g, min(c.g, (c.r + c.b) * 0.5), uDespill * (1.0 - ca));
  }
  c = clamp(c, 0.0, 1.0);
  vec3 backdrop = texture(uBackdrop, gl_FragCoord.xy / uOutSize).rgb;
  vec3 blended = blendRGB(backdrop, c);
  fragColor = vec4(mix(backdrop, blended, clamp(a, 0.0, 1.0)), 1.0);
}`;

interface FBO {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
}

export class GLCompositor {
  private gl: WebGL2RenderingContext | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private program: WebGLProgram | null = null;
  private posBuf: WebGLBuffer | null = null;
  private uvBuf: WebGLBuffer | null = null;
  private slotTex = new Map<number, WebGLTexture>();
  private slotUploaded = new Map<number, number>(); // slot → last uploaded currentTime
  /** Static-image textures (part 16 title rasters), id → texture + content key. */
  private imageTex = new Map<string, { tex: WebGLTexture; key: string }>();
  private lutTex = new Map<string, { tex: WebGLTexture; size: number }>();
  private dummyLut: WebGLTexture | null = null;
  /** 1×1 2D texture bound for solid layers (the shader ignores the sample). */
  private dummyTex2D: WebGLTexture | null = null;
  private accum: FBO | null = null;
  private temp: FBO | null = null;
  private fboW = 0;
  private fboH = 0;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private attribs: { pos: number; uv: number } = { pos: -1, uv: -1 };
  private lost = false;
  private renderScale = 1;
  onContextLost?: () => void;
  onContextRestored?: () => void;

  /** Returns true if a WebGL2 context + resources were created. */
  init(canvas: HTMLCanvasElement): boolean {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      // antialias defaults to true, which makes the DEFAULT framebuffer
      // multisampled — and you cannot blitFramebuffer INTO a multisampled
      // buffer (only resolve out of one). Our final present blits the accum FBO
      // to the default framebuffer, so MSAA must be off or that blit throws
      // GL_INVALID_OPERATION every frame (black screen). We render at project
      // resolution and letterbox via CSS, so canvas MSAA buys us nothing.
      antialias: false,
      premultipliedAlpha: false,
      desynchronized: true,
      preserveDrawingBuffer: false,
    }) as WebGL2RenderingContext | null;
    if (!gl) return false;
    this.gl = gl;

    canvas.addEventListener('webglcontextlost', this.handleLost, false);
    canvas.addEventListener('webglcontextrestored', this.handleRestored, false);

    return this.buildResources();
  }

  private handleLost = (e: Event) => {
    e.preventDefault(); // required for restore to fire
    this.lost = true;
    this.onContextLost?.();
  };

  private handleRestored = () => {
    this.lost = false;
    this.slotTex.clear();
    this.slotUploaded.clear();
    this.imageTex.clear();
    this.lutTex.clear();
    this.accum = null;
    this.temp = null;
    this.fboW = 0;
    this.fboH = 0;
    if (this.canvas && this.gl) {
      this.buildResources();
      this.onContextRestored?.();
    }
  };

  private buildResources(): boolean {
    const gl = this.gl;
    if (!gl) return false;
    const program = linkProgram(gl, VERT_SRC, FRAG_SRC);
    if (!program) return false;
    this.program = program;
    this.attribs.pos = gl.getAttribLocation(program, 'aPos');
    this.attribs.uv = gl.getAttribLocation(program, 'aUV');
    for (const name of [
      'uSource', 'uBackdrop', 'uLut', 'uOutSize', 'uOpacity', 'uBlendMode',
      'uHasEq', 'uEq', 'uHasLumetri', 'uExposure', 'uLumContrast', 'uLumSaturation',
      'uTemperature', 'uTint', 'uVibrance', 'uHasLut', 'uLutIntensity',
      'uHasChroma', 'uKeyColor', 'uSimilarity', 'uChromaBlend', 'uDespill',
      'uHasSolid', 'uSolidColor', 'uHasWipe', 'uWipe',
    ]) {
      this.uniforms[name] = gl.getUniformLocation(program, name);
    }
    this.posBuf = gl.createBuffer();
    this.uvBuf = gl.createBuffer();
    this.dummyLut = this.makeDummyLut();
    this.dummyTex2D = this.makeDummyTex2D();
    return true;
  }

  isAvailable(): boolean {
    return !!this.gl && !this.lost && !!this.program;
  }

  private makeDummyLut(): WebGLTexture | null {
    const gl = this.gl;
    if (!gl) return null;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB8, 1, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0]));
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private makeDummyTex2D(): WebGLTexture | null {
    const gl = this.gl;
    if (!gl) return null;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  hasLut(key: string): boolean {
    return this.lutTex.has(key);
  }

  /** Uploads a parsed .cube LUT as a 3D texture, cached per key. */
  loadLut(key: string, lut: ParsedLut): void {
    const gl = this.gl;
    if (!gl || this.lutTex.has(key)) return;
    const tex = gl.createTexture();
    if (!tex) return;
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB8, lut.size, lut.size, lut.size, 0, gl.RGB, gl.UNSIGNED_BYTE, lut.data);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    this.lutTex.set(key, { tex, size: lut.size });
  }

  private slotTexture(slot: number): WebGLTexture | null {
    const gl = this.gl;
    if (!gl) return null;
    let tex = this.slotTex.get(slot);
    if (!tex) {
      const created = gl.createTexture();
      if (!created) return null;
      tex = created;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.slotTex.set(slot, tex);
    }
    return tex;
  }

  /**
   * Uploads a video frame into a slot's texture. `frameKey` (e.g. el.currentTime
   * or an rVFC counter) dedupes uploads when the frame hasn't changed. Returns
   * true if a new frame was uploaded.
   */
  uploadSlot(slot: number, video: HTMLVideoElement, frameKey: number): boolean {
    const gl = this.gl;
    if (!gl || this.lost) return false;
    if (video.readyState < 2 || video.videoWidth === 0) return false;
    if (this.slotUploaded.get(slot) === frameKey) return false;
    const tex = this.slotTexture(slot);
    if (!tex) return false;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    } catch {
      return false;
    }
    this.slotUploaded.set(slot, frameKey);
    return true;
  }

  /**
   * Uploads a static image (a title raster canvas) into the texture registered
   * under `id`. `key` identifies the CONTENT (title JSON + raster size): when
   * it matches the last upload the call is a no-op — the dirty-flag contract
   * that keeps title rasters off the per-frame hot path. Returns true when the
   * texture holds the keyed content (fresh or cached).
   */
  uploadImage(id: string, source: TexImageSource, key: string): boolean {
    const gl = this.gl;
    if (!gl || this.lost) return false;
    const existing = this.imageTex.get(id);
    if (existing && existing.key === key) return true;
    let tex = existing?.tex;
    if (!tex) {
      const created = gl.createTexture();
      if (!created) return false;
      tex = created;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, tex);
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    // Title rasters carry straight (non-premultiplied) alpha, matching the
    // pipeline's alpha model.
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } catch {
      return false;
    }
    this.imageTex.set(id, { tex, key });
    return true;
  }

  hasImage(id: string): boolean {
    return this.imageTex.has(id);
  }

  /** Frees image textures whose id is not in `live` (deleted/closed title clips). */
  pruneImages(live: Set<string>): void {
    const gl = this.gl;
    for (const [id, entry] of this.imageTex) {
      if (live.has(id)) continue;
      if (gl) gl.deleteTexture(entry.tex);
      this.imageTex.delete(id);
    }
  }

  private makeFBO(w: number, h: number): FBO | null {
    const gl = this.gl;
    if (!gl) return null;
    const tex = gl.createTexture();
    const fb = gl.createFramebuffer();
    if (!tex || !fb) return null;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { fb, tex };
  }

  private ensureFBOs(w: number, h: number): boolean {
    if (this.fboW === w && this.fboH === h && this.accum && this.temp) return true;
    const gl = this.gl;
    if (!gl) return false;
    if (this.accum) {
      gl.deleteTexture(this.accum.tex);
      gl.deleteFramebuffer(this.accum.fb);
    }
    if (this.temp) {
      gl.deleteTexture(this.temp.tex);
      gl.deleteFramebuffer(this.temp.fb);
    }
    this.accum = this.makeFBO(w, h);
    this.temp = this.makeFBO(w, h);
    this.fboW = w;
    this.fboH = h;
    return !!this.accum && !!this.temp;
  }

  /**
   * Preview quality (part 11): internal render resolution = backing size ×
   * renderScale (Full 1 / Half 0.5 / Quarter 0.25). The canvas backing store
   * shrinks with the FBOs and CSS (`object-contain`, full-size element) does
   * the upscale — every per-pixel cost (fragment work, blits, texture fills)
   * scales with scale². Takes effect on the next composite(); no reallocation
   * here, ensureFBOs handles the resize.
   */
  setRenderScale(scale: number): void {
    this.renderScale = Math.min(1, Math.max(0.1, scale));
  }

  getRenderScale(): number {
    return this.renderScale;
  }

  /** Computes the FBO/canvas backing size for a project, capping the long edge. */
  backingSize(projectW: number, projectH: number): { w: number; h: number } {
    const longEdge = Math.max(projectW, projectH);
    const k = (longEdge > MAX_BACKING_DIM ? MAX_BACKING_DIM / longEdge : 1) * this.renderScale;
    return { w: Math.max(2, Math.round(projectW * k)), h: Math.max(2, Math.round(projectH * k)) };
  }

  /**
   * Composites the layers (bottom→top) into the canvas at the project's aspect.
   * Layers must already have their slot textures uploaded via uploadSlot().
   */
  composite(layers: GLLayer[], projectW: number, projectH: number): void {
    const gl = this.gl;
    if (!gl || this.lost || !this.program) return;
    const { w, h } = this.backingSize(projectW, projectH);
    const canvas = this.canvas;
    if (canvas && (canvas.width !== w || canvas.height !== h)) {
      canvas.width = w;
      canvas.height = h;
    }
    if (!this.ensureFBOs(w, h)) return;

    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.program);
    gl.viewport(0, 0, w, h);

    // Clear accum to opaque black (the letterbox base).
    let accum = this.accum as FBO;
    let temp = this.temp as FBO;
    gl.bindFramebuffer(gl.FRAMEBUFFER, accum.fb);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    for (const layer of layers) {
      const srcTex = layer.solid
        ? this.dummyTex2D
        : layer.imageKey !== undefined
          ? this.imageTex.get(layer.imageKey)?.tex ?? null
          : this.slotTex.get(layer.slot);
      if (!srcTex) continue;

      // 1) copy accum → temp so pixels outside the layer quad carry through.
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, accum.fb);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, temp.fb);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);

      // 2) draw the layer quad into temp, sampling accum as the backdrop.
      gl.bindFramebuffer(gl.FRAMEBUFFER, temp.fb);
      gl.viewport(0, 0, w, h);
      this.drawLayer(layer, srcTex, accum.tex, w, h);

      // 3) swap.
      const t = accum;
      accum = temp;
      temp = t;
    }

    // Blit final composite to the default framebuffer (canvas).
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, accum.fb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.accum = accum;
    this.temp = temp;
  }

  private drawLayer(layer: GLLayer, srcTex: WebGLTexture, backdropTex: WebGLTexture, w: number, h: number): void {
    const gl = this.gl;
    if (!gl) return;
    const { positions, uvs } = quadGeometry(layer, w, h);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.attribs.pos);
    gl.vertexAttribPointer(this.attribs.pos, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.attribs.uv);
    gl.vertexAttribPointer(this.attribs.uv, 2, gl.FLOAT, false, 0, 0);

    const u = this.uniforms;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.uniform1i(u.uSource, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, backdropTex);
    gl.uniform1i(u.uBackdrop, 1);

    const lut = layer.lut ? this.lutTex.get(layer.lut.key) : undefined;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_3D, lut ? lut.tex : this.dummyLut);
    gl.uniform1i(u.uLut, 2);

    gl.uniform2f(u.uOutSize, w, h);
    gl.uniform1f(u.uOpacity, clamp01(layer.opacity));
    gl.uniform1i(u.uBlendMode, BLEND_INDEX[layer.blendMode ?? 'normal'] ?? 0);

    gl.uniform1i(u.uHasEq, layer.eq ? 1 : 0);
    if (layer.eq) gl.uniform3f(u.uEq, layer.eq.brightness, layer.eq.contrast, layer.eq.saturation);

    gl.uniform1i(u.uHasLumetri, layer.lumetri ? 1 : 0);
    if (layer.lumetri) {
      gl.uniform1f(u.uExposure, layer.lumetri.exposure);
      gl.uniform1f(u.uLumContrast, layer.lumetri.contrast);
      gl.uniform1f(u.uLumSaturation, layer.lumetri.saturation);
      gl.uniform1f(u.uTemperature, layer.lumetri.temperature);
      gl.uniform1f(u.uTint, layer.lumetri.tint);
      gl.uniform1f(u.uVibrance, layer.lumetri.vibrance);
    }

    gl.uniform1i(u.uHasLut, lut ? 1 : 0);
    gl.uniform1f(u.uLutIntensity, layer.lut ? clamp01(layer.lut.intensity) : 0);

    gl.uniform1i(u.uHasChroma, layer.chroma ? 1 : 0);
    if (layer.chroma) {
      gl.uniform3f(u.uKeyColor, layer.chroma.keyColor[0], layer.chroma.keyColor[1], layer.chroma.keyColor[2]);
      gl.uniform1f(u.uSimilarity, layer.chroma.similarity);
      gl.uniform1f(u.uChromaBlend, layer.chroma.blend);
      gl.uniform1f(u.uDespill, layer.chroma.despill);
    }

    gl.uniform1i(u.uHasSolid, layer.solid ? 1 : 0);
    if (layer.solid) gl.uniform3f(u.uSolidColor, layer.solid[0], layer.solid[1], layer.solid[2]);

    gl.uniform1i(u.uHasWipe, layer.wipe ? 1 : 0);
    if (layer.wipe) {
      gl.uniform4f(u.uWipe, clamp01(layer.wipe.left), clamp01(layer.wipe.top), clamp01(layer.wipe.right), clamp01(layer.wipe.bottom));
    }

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /**
   * Reads back a single composited pixel at normalized (u,v) (top-left origin)
   * from the latest composite, for the chroma-key eyedropper. Returns RGB 0..255.
   */
  readPixelNorm(u: number, v: number): [number, number, number] | null {
    const gl = this.gl;
    if (!gl || this.lost || !this.accum) return null;
    const x = Math.max(0, Math.min(this.fboW - 1, Math.floor(u * this.fboW)));
    const yTop = Math.max(0, Math.min(this.fboH - 1, Math.floor(v * this.fboH)));
    const y = this.fboH - 1 - yTop; // GL readPixels origin is bottom-left
    const buf = new Uint8Array(4);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.accum.fb);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    return [buf[0], buf[1], buf[2]];
  }

  /**
   * Full-frame RGBA readback of the latest composite, rows top-down. Reads the
   * accum FBO directly (persistent texture), so it needs neither
   * preserveDrawingBuffer nor timing against the canvas present — the
   * parity-harness capture path (part 13) depends on that.
   */
  readAccumPixels(): { width: number; height: number; data: Uint8ClampedArray } | null {
    const gl = this.gl;
    if (!gl || this.lost || !this.accum || this.fboW === 0 || this.fboH === 0) return null;
    const w = this.fboW;
    const h = this.fboH;
    const raw = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.accum.fb);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    // GL rows come back bottom-up; flip to image order (top-down).
    const data = new Uint8ClampedArray(w * h * 4);
    const rowBytes = w * 4;
    for (let y = 0; y < h; y += 1) {
      data.set(raw.subarray((h - 1 - y) * rowBytes, (h - y) * rowBytes), y * rowBytes);
    }
    return { width: w, height: h, data };
  }

  /**
   * The unmasked GPU renderer string (WEBGL_debug_renderer_info), '' when the
   * extension is unavailable. The parity harness asserts this matches the
   * rasterizer it expects (NVIDIA vs SwiftShader) before trusting any frame.
   */
  rendererInfo(): string {
    const gl = this.gl;
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return '';
    return String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '');
  }

  /** Backing FBO dimensions (for mapping client coords to readPixelNorm). */
  get backingW(): number {
    return this.fboW;
  }
  get backingH(): number {
    return this.fboH;
  }

  dispose(): void {
    const gl = this.gl;
    if (this.canvas) {
      this.canvas.removeEventListener('webglcontextlost', this.handleLost);
      this.canvas.removeEventListener('webglcontextrestored', this.handleRestored);
    }
    if (gl) {
      this.slotTex.forEach((t) => gl.deleteTexture(t));
      this.imageTex.forEach((e) => gl.deleteTexture(e.tex));
      this.lutTex.forEach((l) => gl.deleteTexture(l.tex));
      if (this.dummyLut) gl.deleteTexture(this.dummyLut);
      if (this.dummyTex2D) gl.deleteTexture(this.dummyTex2D);
      if (this.accum) {
        gl.deleteTexture(this.accum.tex);
        gl.deleteFramebuffer(this.accum.fb);
      }
      if (this.temp) {
        gl.deleteTexture(this.temp.tex);
        gl.deleteFramebuffer(this.temp.fb);
      }
      if (this.program) gl.deleteProgram(this.program);
    }
    this.slotTex.clear();
    this.imageTex.clear();
    this.lutTex.clear();
    this.gl = null;
    this.program = null;
  }
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/**
 * quadGeometry computes the 4 clip-space corner positions + source UVs for a
 * layer, implementing the shared transform spec (crop → fit → position →
 * rotate). Triangle-strip order: TL, BL, TR, BR.
 */
function quadGeometry(layer: GLLayer, W: number, H: number): { positions: Float32Array; uvs: Float32Array } {
  const cl = layer.crop?.left ?? 0;
  const ct = layer.crop?.top ?? 0;
  const cr = layer.crop?.right ?? 0;
  const cb = layer.crop?.bottom ?? 0;
  const croppedW = Math.max(1, layer.srcW * (1 - cl - cr));
  const croppedH = Math.max(1, layer.srcH * (1 - ct - cb));

  const scale = layer.transform?.scale ?? 1;
  const boxW = W * scale;
  const boxH = H * scale;
  const fit = Math.min(boxW / croppedW, boxH / croppedH);
  const drawW = croppedW * fit;
  const drawH = croppedH * fit;

  const cx = W / 2 + (layer.transform?.x ?? 0) * W;
  const cy = H / 2 + (layer.transform?.y ?? 0) * H;
  const theta = ((layer.transform?.rotationDeg ?? 0) * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  // Clockwise rotation in y-down pixel space: x'=x·cos − y·sin, y'=x·sin + y·cos.
  const corner = (dx: number, dy: number): [number, number] => {
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    const px = cx + rx;
    const py = cy + ry;
    return [(px / W) * 2 - 1, 1 - (py / H) * 2]; // → clip space
  };

  const hw = drawW / 2;
  const hh = drawH / 2;
  const tl = corner(-hw, -hh);
  const bl = corner(-hw, hh);
  const tr = corner(hw, -hh);
  const br = corner(hw, hh);

  // UVs (FLIP_Y false → v=0 is image top, v increases downward).
  const u0 = cl;
  const u1 = 1 - cr;
  const v0 = ct;
  const v1 = 1 - cb;

  return {
    positions: new Float32Array([tl[0], tl[1], bl[0], bl[1], tr[0], tr[1], br[0], br[1]]),
    uvs: new Float32Array([u0, v0, u0, v1, u1, v0, u1, v1]),
  };
}

function linkProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}
