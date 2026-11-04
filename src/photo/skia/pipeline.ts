/**
 * The MA51 render pipeline (ticket decisions 2, 4, 7): geometry → masks → adjustments → detail,
 * mirroring the web's `PhotoRenderer.render` (UI main 615d7c0) on Skia with the API injected (the
 * app passes `Skia`; the parity test passes the same JSI API on CanvasKit).
 *
 * Working image: straight (un-premultiplied) colour in an opaque raster plus a separate alpha
 * raster, both at the geometry-corrected size. Layers never touch alpha, so it is computed once;
 * keeping colour straight means a transparent pixel keeps its colour through the chain (the web's
 * float texture does the same) and the geometry's bilinear runs on straight values like
 * `applyGeometryCPU`. `JOIN_SKSL` premultiplies at the end.
 *
 * Passes:
 * - geometry: one resample of the source (cached by geometry + source); identity = the source;
 * - masks: per distinct mask (cache key = mask + geometry + source, the web's `maskCacheKey`): fold
 *   the components into an offscreen surface, one runtime shader per component, then the feather
 *   (separable Gaussian, the same taps as `blurMask`) and a lazy invert/opacity finish shader;
 * - runs of per-pixel layers are composed into ONE shader chain (MA50's `chainShaders`, each layer
 *   given its mask shader);
 * - a detail layer materialises its input (a raster) and runs its multi-pass chain.
 *
 * Everything returns shaders/images in output pixel space (0,0)-(w,h). Surfaces are CPU rasters
 * (`Surface.Make`) for exact readback; the canvas draws the final shader.
 */
import type { SkImage, SkShader, SkSurface } from '@shopify/react-native-skia';
import { dehazeLight, featherSigma, resolveLayerMask } from '../colorMath';
import type { AdjustmentLayer, Geometry, Mask, MaskComponent, PhotoDoc } from '../photoTypes';
import {
  hasGeometry,
  KeyedCache,
  maskCacheKey,
  MAX_GPU_COLOR_TARGETS,
  MODE_INDEX,
  packGeometry,
  packMaskComponent,
  planGeometry,
} from '../webMaskPlan';
import { DEHAZE_GRID, isDetailType, planDetail, type DetailPlan } from '../webDetailPlan';
import { BLEND_INDEX } from '../webUniforms';
import { chainShaders, type SkiaApi } from './shaderChain';
import { detailSksl, saltedSeed, seedLimbs, type DetailPass } from './shaders/detail';
import {
  GEOMETRY_SKSL,
  JOIN_SKSL,
  maskComponentSksl,
  MASK_FINISH_SKSL,
  MASK_VIEW_SKSL,
  SPLIT_SKSL,
  type MaskPassKind,
} from './shaders/maskGeo';

// Enum values (a pure module must not import RN Skia at runtime).
const CLAMP = 0;
const FILTER_NEAREST = 0;
const MIP_NONE = 0;
const RGBA_8888 = 4;
const UNPREMUL = 3;
const BLEND_SRC = 1;

export type MaskView = 'off' | 'overlay' | 'alpha';

/** Decoded brush / subject rasters, keyed by the brush PNG data URI or the subject `maskRef`. */
export interface AlphaSource {
  get(id: string): SkImage | null;
}

export interface PipelineSource {
  /** The (premultiplied) preview source as decoded. */
  image: SkImage;
  /** Changes when the source pixels change (a heal swaps the base). */
  id: string;
  /**
   * Already split straight colour (opaque) + alpha (grey). Tests pass the fixture's exact bytes:
   * a premultiplied decode cannot keep the colour of fully transparent pixels, which the
   * reference keeps and neighbourhood ops (blur, bilinear) read.
   */
  split?: { color: SkImage; alpha: SkImage };
}

export interface RenderOptions {
  maskView?: MaskView;
  viewLayerId?: string | null;
  /** Skip every layer (the "before" view keeps geometry, like the web's compare). */
  before?: boolean;
}

export interface Rendered {
  /** Premultiplied output shader in output pixel space. */
  shader: SkShader;
  width: number;
  height: number;
}

type Effect = ReturnType<SkiaApi['RuntimeEffect']['Make']> & object;

const exact = (img: SkImage) => img.makeShaderOptions(CLAMP, CLAMP, FILTER_NEAREST, MIP_NONE);

/** Uniform values in declaration order, filled by name (missing = 0). */
function uniforms(effect: Effect, values: Record<string, readonly number[] | number>): number[] {
  const out = new Array<number>(effect.getUniformFloatCount()).fill(0);
  for (let i = 0; i < effect.getUniformCount(); i += 1) {
    const v = values[effect.getUniformName(i)];
    if (v === undefined) continue;
    const slot = effect.getUniform(i).slot;
    const arr = typeof v === 'number' ? [v] : v;
    for (let k = 0; k < arr.length; k += 1) out[slot + k] = arr[k]!;
  }
  return out;
}

class Effects {
  private map = new Map<string, Effect>();
  constructor(private readonly api: SkiaApi) {}
  get(key: string, src: () => string): Effect {
    let e = this.map.get(key);
    if (!e) {
      const made = this.api.RuntimeEffect.Make(src());
      if (!made) throw new Error(`SkSL ${key} did not compile`);
      e = made;
      this.map.set(key, e);
    }
    return e;
  }
}

const effectsByApi = new WeakMap<object, Effects>();
const effectsFor = (api: SkiaApi) => {
  let e = effectsByApi.get(api);
  if (!e) {
    e = new Effects(api);
    effectsByApi.set(api, e);
  }
  return e;
};

const IDENTITY: Geometry = {
  rotate: 0,
  flipH: false,
  flipV: false,
  perspective: null,
  crop: null,
  fill: 'transparent',
};

/**
 * One renderer per editor (per preview source). Holds the caches: the split source, the geometry
 * result, finished masks (LRU 12, like the web) and materialised detail inputs are rebuilt only
 * when their keys change, so a slider drag on an adjustment recomputes nothing but the chain.
 */
export class PhotoPipeline {
  private readonly fx: Effects;
  private split: { id: string; color: SkImage; alpha: SkImage } | null = null;
  private geo: { key: string; color: SkImage; alpha: SkImage } | null = null;
  private readonly masks = new KeyedCache<SkImage>(12);
  private readonly detail = new KeyedCache<SkImage>(6);
  /** Counts mask computes (tests read it to prove the cache). */
  get maskComputes(): number {
    return this.masks.computes;
  }

  /**
   * `gpu` (the phone): bakes on an offscreen GPU surface and copies the result to a raster image
   * (`makeNonTextureImage`), because the canvas draws on another thread's context and cannot
   * sample a texture made here (MA50's `downscale` does the same). Tests use CPU rasters.
   */
  constructor(
    private readonly api: SkiaApi,
    private readonly alphas: AlphaSource = { get: () => null },
    private readonly opts: {
      gpu?: boolean;
      /** Mask feather: `exact` = the reference's Gaussian taps; `skia` = `ImageFilter.MakeBlur`. */
      feather?: 'exact' | 'skia';
    } = {},
  ) {
    this.fx = effectsFor(api);
  }

  /** Forget cached masks (a brush or subject raster was decoded or replaced). */
  invalidateMasks(): void {
    this.masks.clear();
    this.detail.clear();
  }

  private surface(w: number, h: number): SkSurface {
    const s =
      (this.opts.gpu ? this.api.Surface.MakeOffscreen(w, h) : null) ?? this.api.Surface.Make(w, h);
    if (!s) throw new Error(`surface ${w}x${h}`);
    return s;
  }

  /** Draw `shader` into a fresh w×h raster (Src blend: no blending with the cleared surface). */
  private bake(shader: SkShader, w: number, h: number): SkImage {
    const s = this.surface(w, h);
    const paint = this.api.Paint();
    paint.setBlendMode(BLEND_SRC);
    paint.setShader(shader);
    s.getCanvas().drawRect(this.api.XYWHRect(0, 0, w, h), paint);
    s.flush();
    const img = s.makeImageSnapshot();
    return this.opts.gpu ? (img.makeNonTextureImage() ?? img) : img;
  }

  private run(
    key: string,
    src: () => string,
    values: Record<string, readonly number[] | number>,
    children: SkShader[],
  ): SkShader {
    const e = this.fx.get(key, src);
    return e.makeShaderWithChildren(uniforms(e, values), children);
  }

  private splitSource(source: PipelineSource) {
    if (this.split?.id === source.id) return this.split;
    const w = source.image.width();
    const h = source.image.height();
    const img = exact(source.image);
    const color =
      source.split?.color ??
      this.bake(
        this.run('split', () => SPLIT_SKSL, { uOut: 0 }, [img]),
        w,
        h,
      );
    const alpha =
      source.split?.alpha ??
      this.bake(
        this.run('split', () => SPLIT_SKSL, { uOut: 1 }, [img]),
        w,
        h,
      );
    this.split = { id: source.id, color, alpha };
    this.geo = null;
    this.masks.clear();
    this.detail.clear();
    return this.split;
  }

  /** The geometry-corrected straight colour + alpha (the source when the geometry is identity). */
  geometry(source: PipelineSource, g: Geometry): { color: SkImage; alpha: SkImage; key: string } {
    const s = this.splitSource(source);
    if (!hasGeometry(g)) return { color: s.color, alpha: s.alpha, key: `${source.id}|id` };
    const key = `${source.id}|${JSON.stringify(g)}`;
    if (this.geo?.key === key) return this.geo;
    const plan = planGeometry(g, s.color.width(), s.color.height());
    const pk = packGeometry(plan);
    const { width: w, height: h } = pk.size;
    const base = {
      uG0: pk.g0,
      uG1: pk.g1,
      uG2: pk.g2,
      uG3: pk.g3,
      uG4: pk.g4,
      uFill: [...pk.fillColor, 1],
    };
    const kids = [exact(s.color), exact(s.alpha)];
    const color = this.bake(
      this.run('geo', () => GEOMETRY_SKSL, { ...base, uG5: [pk.g5[0], pk.g5[1], 0, 0] }, kids),
      w,
      h,
    );
    const alpha = this.bake(
      this.run('geo', () => GEOMETRY_SKSL, { ...base, uG5: [pk.g5[0], pk.g5[1], 1, 0] }, kids),
      w,
      h,
    );
    this.geo = { key, color, alpha };
    return this.geo;
  }

  /** Fold → feather → (lazy) invert/opacity. Returns the finished mask as a shader. */
  private computeMask(mask: Mask, image: SkImage): SkImage {
    const w = image.width();
    const h = image.height();
    const src = exact(image);
    let prev: SkImage | null = null;
    for (const c of mask.components) {
      const pass = this.componentPass(c, prev, src, w, h);
      if (pass) prev = pass;
    }
    if (!prev) prev = this.bake(this.api.Shader.MakeColor(this.api.Color('black')), w, h);
    const sigma = featherSigma(mask.feather, w, h);
    let m = prev;
    if (sigma >= 1e-3 && this.opts.feather === 'skia') {
      const s = this.surface(w, h);
      const paint = this.api.Paint();
      paint.setBlendMode(BLEND_SRC);
      paint.setImageFilter(this.api.ImageFilter.MakeBlur(sigma, sigma, CLAMP, null));
      s.getCanvas().drawImage(prev, 0, 0, paint);
      s.flush();
      const img = s.makeImageSnapshot();
      m = this.opts.gpu ? (img.makeNonTextureImage() ?? img) : img;
    } else if (sigma >= 1e-3) {
      // Separable Gaussian on the folded mask: the taps and edge replication of `blurMask`.
      const common = { uSize: [w, h], uSigma: sigma, uOpacity: 1 };
      const hp = this.bake(
        this.run('d:GAUSS_H', () => detailSksl('GAUSS_H'), { ...common, uDir: [1, 0], uMode: 1 }, [
          exact(m),
          exact(m),
          exact(m),
          exact(m),
        ]),
        w,
        h,
      );
      m = this.bake(
        this.run('d:GAUSS_V', () => detailSksl('GAUSS_V'), { ...common, uDir: [0, 1] }, [
          exact(hp),
          exact(hp),
          exact(hp),
          exact(hp),
        ]),
        w,
        h,
      );
    }
    return this.bake(
      this.run(
        'mfinish',
        () => MASK_FINISH_SKSL,
        { uInvert: mask.invert ? 1 : 0, uOpacity: mask.opacity },
        [exact(m)],
      ),
      w,
      h,
    );
  }

  private componentPass(
    c: MaskComponent,
    prev: SkImage | null,
    src: SkShader,
    w: number,
    h: number,
  ): SkImage | null {
    const packed = packMaskComponent(c);
    let alpha: SkImage | null = null;
    if (packed.alpha) {
      alpha = this.alphas.get(
        packed.alpha.kind === 'brush' ? packed.alpha.png : packed.alpha.maskRef,
      );
      // Pixels not available: the component is skipped (as the CPU reference).
      if (!alpha) return null;
    }
    const kind: MaskPassKind =
      c.kind === 'brush' || c.kind === 'subject' ? 'alpha' : (c.kind as MaskPassKind);
    const lab = new Array<number>(MAX_GPU_COLOR_TARGETS * 4).fill(0);
    for (let i = 0; i < MAX_GPU_COLOR_TARGETS; i += 1) {
      lab[i * 4] = packed.lab[i * 3]!;
      lab[i * 4 + 1] = packed.lab[i * 3 + 1]!;
      lab[i * 4 + 2] = packed.lab[i * 3 + 2]!;
    }
    const black = this.api.Shader.MakeColor(this.api.Color('black'));
    const shader = this.run(
      `m:${kind}`,
      () => maskComponentSksl(kind),
      {
        uSize: [w, h],
        uMode: MODE_INDEX[c.mode],
        uFirst: prev ? 0 : 1,
        uM0: packed.m0,
        uM1: packed.m1,
        uLab: lab,
        uAlphaSize: alpha ? [alpha.width(), alpha.height()] : [1, 1],
      },
      [src, prev ? exact(prev) : black, alpha ? exact(alpha) : black],
    );
    return this.bake(shader, w, h);
  }

  /** The finished mask raster of a mask on this image (cached), or null for an empty mask. */
  maskImage(
    mask: Mask | null,
    geometry: Geometry,
    sourceId: string,
    image: SkImage,
  ): SkImage | null {
    if (!mask || mask.components.length === 0) return null;
    const key = maskCacheKey(mask, geometry, sourceId);
    return this.masks.get(key, () => this.computeMask(mask, image));
  }

  /** Run a detail layer over the materialised `input` (straight colour). */
  private runDetail(
    plan: DetailPlan,
    input: SkImage,
    layer: AdjustmentLayer,
    mask: SkImage | null,
  ): SkShader {
    const w = input.width();
    const h = input.height();
    const inp = exact(input);
    const ones = this.api.Shader.MakeColor(this.api.Color('white'));
    const m = mask ? exact(mask) : ones;
    const common = {
      uSize: [w, h],
      uOpacity: layer.opacity,
      uBlend: BLEND_INDEX[layer.blend],
      uHasMask: mask ? 1 : 0,
    };
    const pass = (
      name: DetailPass,
      values: Record<string, readonly number[] | number>,
      prev: SkShader = ones,
      input: SkShader = inp,
      aux: SkShader = ones,
    ) =>
      this.run(`d:${name}`, () => detailSksl(name), { ...common, ...values }, [
        input,
        prev,
        m,
        aux,
      ]);
    switch (plan.kind) {
      case 'unsharp': {
        const a = this.bake(pass('GAUSS_H', { uDir: [1, 0], uSigma: plan.sigma, uMode: 0 }), w, h);
        return pass(
          'UNSHARP_V',
          {
            uDir: [0, 1],
            uSigma: plan.sigma,
            uP0: [plan.gain, plan.mid ? 1 : 0, plan.threshold, 0],
          },
          exact(a),
        );
      }
      case 'blur': {
        const a = this.bake(pass('GAUSS_H', { uDir: [1, 0], uSigma: plan.sigma, uMode: 1 }), w, h);
        return pass('BLUR_V', { uDir: [0, 1], uSigma: plan.sigma }, exact(a));
      }
      case 'nr': {
        const p = [plan.sigmaS, plan.sigmaR, plan.chroma, plan.luma ? 1 : 0];
        const l = this.bake(pass('NR_L', {}), w, h);
        const ab = this.bake(pass('NR_AB', {}), w, h);
        const bil = this.bake(pass('NR_BIL', { uP0: p }, ones, exact(l)), w, h);
        const abH = this.bake(pass('NR_AB_H', { uP0: p }, ones, exact(ab)), w, h);
        return pass('NR_FIN', { uP0: p }, exact(bil), inp, exact(abH));
      }
      case 'dehaze': {
        const darkH = this.bake(pass('DARK_H', {}), w, h);
        const light = this.dehazeLight(darkH, w, h, common);
        return pass('DEHAZE', { uP0: [plan.amount, light, 0, 0] }, exact(darkH));
      }
      case 'vignette':
        return pass('VIGNETTE', {
          uP0: [plan.amount, plan.midpoint, plan.roundness, plan.feather],
          uP1: [plan.highlights, 0, 0, 0],
        });
      case 'grain':
        return pass('GRAIN', {
          uP0: [plan.amount, plan.size, plan.roughness, 0],
          uSeed: seedLimbs(plan.seed),
          uSeed2: seedLimbs(saltedSeed(plan.seed)),
        });
    }
  }

  /**
   * Atmospheric light: the 99.5th percentile of the dark channel. Images up to the grid's pixel
   * count use every pixel (= `colorMath.dehaze`); larger ones a DEHAZE_GRID² sample like the web
   * preview (design §5.4 approximation).
   */
  private dehazeLight(darkH: SkImage, w: number, h: number, common: Record<string, unknown>) {
    const full = w * h <= 512 * 512;
    const gw = full ? w : DEHAZE_GRID;
    const gh = full ? h : DEHAZE_GRID;
    const grid = this.bake(
      this.run(
        'd:DARK_V',
        () => detailSksl('DARK_V'),
        { ...(common as object), uP0: [w / gw, h / gh, 0, 0] },
        [exact(darkH), exact(darkH), exact(darkH), exact(darkH)],
      ),
      gw,
      gh,
    );
    const px = grid.readPixels(0, 0, {
      width: gw,
      height: gh,
      colorType: RGBA_8888,
      alphaType: UNPREMUL,
    });
    if (!(px instanceof Uint8Array)) return 0.05;
    const vals = new Float64Array(gw * gh);
    for (let i = 0; i < vals.length; i += 1) vals[i] = px[i * 4]! / 255;
    return dehazeLight(vals);
  }

  /** The whole document as one premultiplied shader at the geometry-corrected size. */
  render(
    source: PipelineSource,
    doc: Pick<PhotoDoc, 'layers' | 'geometry' | 'masks'>,
    opts: RenderOptions = {},
  ): Rendered {
    const geometry = doc.geometry ?? IDENTITY;
    const g = this.geometry(source, geometry);
    const w = g.color.width();
    const h = g.color.height();
    const layers = opts.before ? [] : doc.layers.filter((l) => l.enabled && l.opacity > 0);
    const maskOf = new Map<AdjustmentLayer, SkImage | null>();
    for (const l of layers)
      maskOf.set(l, this.maskImage(resolveLayerMask(doc, l), geometry, source.id, g.color));

    let cur: SkShader = exact(g.color);
    let curImage: SkImage | null = g.color;
    let chainKey = g.key;
    let run: AdjustmentLayer[] = [];
    const flush = () => {
      if (run.length === 0) return;
      cur = chainShaders(this.api, cur, run, (l) => {
        const m = maskOf.get(l);
        return m ? exact(m) : null;
      });
      chainKey += `|${run.map((l) => JSON.stringify(l)).join(',')}`;
      curImage = null;
      run = [];
    };
    for (const layer of layers) {
      if (!isDetailType(layer.type)) {
        run.push(layer);
        continue;
      }
      flush();
      const plan = planDetail(layer, w, h);
      if (!plan) continue;
      const shaderIn = cur;
      const input: SkImage = curImage ?? this.detail.get(chainKey, () => this.bake(shaderIn, w, h));
      cur = this.runDetail(plan, input, layer, maskOf.get(layer) ?? null);
      chainKey += `|${JSON.stringify(layer)}`;
      curImage = null;
    }
    flush();

    if (opts.maskView && opts.maskView !== 'off' && opts.viewLayerId) {
      const layer = doc.layers.find((l) => l.id === opts.viewLayerId);
      const m = layer
        ? this.maskImage(resolveLayerMask(doc, layer), geometry, source.id, g.color)
        : null;
      if (m)
        cur = this.run(
          'mview',
          () => MASK_VIEW_SKSL,
          { uView: opts.maskView === 'overlay' ? 1 : 2 },
          [cur, exact(m)],
        );
    }
    const shader = this.run('join', () => JOIN_SKSL, {}, [cur, exact(g.alpha)]);
    return { shader, width: w, height: h };
  }

  /** Render to an RGBA8 raster (unpremultiplied) at `width`×`height` (default: output size). */
  readPixels(
    source: PipelineSource,
    doc: Pick<PhotoDoc, 'layers' | 'geometry' | 'masks'>,
    opts: RenderOptions & { width?: number; height?: number } = {},
  ): { pixels: Uint8Array; width: number; height: number } | null {
    const r = this.render(source, doc, opts);
    const w = opts.width ?? r.width;
    const h = opts.height ?? r.height;
    const s = this.api.Surface.Make(w, h);
    if (!s) return null;
    const canvas = s.getCanvas();
    canvas.scale(w / r.width, h / r.height);
    const paint = this.api.Paint();
    paint.setShader(r.shader);
    canvas.drawRect(this.api.XYWHRect(0, 0, r.width, r.height), paint);
    s.flush();
    const px = s
      .makeImageSnapshot()
      .readPixels(0, 0, { width: w, height: h, colorType: RGBA_8888, alphaType: UNPREMUL });
    return px instanceof Uint8Array ? { pixels: px, width: w, height: h } : null;
  }
}
