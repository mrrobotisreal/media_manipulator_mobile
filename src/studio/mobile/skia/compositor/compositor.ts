'worklet';
/**
 * The Darkroom preview compositor on Skia (ticket MA62 decision 6), the port of the web's
 * `GLCompositor.composite` (media-manipulator-ui `lib/studio/glCompositor.ts`, UI commit e9820f7):
 * layers bottom to top over opaque black, each layer = its source -> the SkSL stages it uses ->
 * blended onto the composite so far.
 *
 * GPU object ownership (decision 0, MA60's rule: every shader, paint and image is disposed by hand):
 * - **Effects** are compiled once per compositor (`effectFor` with the compositor's cache), never
 *   disposed (like Aperture's `shaderChain.ts`).
 * - **One `LayerChain` per clip** owns that clip's shaders and its paint. In RN Skia 3 a runtime
 *   shader's uniforms are fixed when it is made (`makeShaderWithChildren` bakes them in), so
 *   "update uniforms" means: on `update(layer)` the chain re-packs each stage and remakes only the
 *   stages whose packed floats changed (and the ones above them, which hold the old one as a
 *   child). An unchanged layer (paused, no keyframes) makes nothing; a keyframed one makes only the
 *   stage that moves. Replaced shaders are **retired**, not disposed: the canvas may still draw the
 *   previous frame's picture with them. `Compositor.endFrame()` disposes what was retired
 *   `RETIRE_FRAMES` frames ago.
 * - **The source** is an image the caller owns (a slot's video texture image from
 *   `gpuFrameSink.ts`, MA76: one per slot), wrapped in one image shader per chain and re-made only
 *   when the image object changes (a resize). A title clip's raster (MA62 S3, `text/titleRasters.ts`)
 *   is such an image too, like the web's uploaded title canvas.
 * - LUT atlases are images cached per LUT key and disposed with the compositor.
 * - `dispose()` releases everything (unmount); counting leak test: `__tests__/compositorLifetime`.
 *
 * Pure apart from the injected Skia API (the app passes `Skia`; jest passes CanvasKit), so the same
 * code runs in the parity tests. Drawing goes onto any `SkCanvas` (the preview records a picture).
 *
 * MA62 S4: the file is a worklet file (`'worklet'` above): `<StudioPreview>` builds and drives the
 * compositor on the Reanimated UI runtime. So nothing here may capture module state the Worklets
 * serializer cannot copy (no module-level WeakMap / Map: the effect cache lives on the compositor),
 * the classes avoid TypeScript parameter properties (the worklet class transform rejects them) and
 * nothing extends `Error`.
 */
import type {
  SkCanvas,
  SkImage,
  SkPaint,
  SkRuntimeEffect,
  SkShader,
  Skia as SkiaApiValue,
} from 'react-native-skia';
import type { ParsedLut } from '../../../../photo/studioLutParser';
import { SAVE_LAYER_INIT_WITH_PREVIOUS, SK_BLEND, SKIA_BLEND_FOR } from './shaders/blend';
import { STAGES, type StageId } from './shaders/stages';
import { lutAtlas, planLayer, type CompLayer } from './uniforms';

export type SkiaApi = typeof SkiaApiValue;

// Numeric enums (TileMode.Clamp, FilterMode, MipmapMode, ColorType.RGBA_8888, AlphaType.Opaque):
// a pure module must not import RN Skia at runtime.
const CLAMP = 0;
const FILTER_NEAREST = 0;
const FILTER_LINEAR = 1;
const MIP_NONE = 0;
const RGBA_8888 = 4;
const ALPHA_OPAQUE = 1;

/** Frames a replaced shader stays alive (the canvas may still be drawing the previous picture). */
export const RETIRE_FRAMES = 3;

interface Disposable {
  dispose?: () => void;
}
const disposeOne = (o: Disposable | null | undefined) => {
  try {
    o?.dispose?.();
  } catch {
    // already disposed
  }
};

/** A stage's SkSL failed to compile (`error.name === 'ShaderCompileError'`, `error.stage`). */
export function shaderCompileError(stage: StageId): Error & { stage: StageId } {
  const e = new Error(`SkSL for the ${stage} stage did not compile`) as Error & { stage: StageId };
  e.name = 'ShaderCompileError';
  e.stage = stage;
  return e;
}

export type EffectCache = Map<StageId, SkRuntimeEffect>;

/** The compiled effect for a stage, from `cache` (one per compositor; effects are never disposed). */
export function effectFor(api: SkiaApi, stage: StageId, cache: EffectCache): SkRuntimeEffect {
  let e = cache.get(stage);
  if (!e) {
    const made = api.RuntimeEffect.Make(STAGES[stage].sksl);
    if (!made) throw shaderCompileError(stage);
    e = made;
    cache.set(stage, e);
  }
  return e;
}

/** Where a layer's pixels come from this frame. */
export type LayerSource =
  | { kind: 'image'; image: SkImage }
  /** A dip's solid colour (straight RGB 0..1). */
  | { kind: 'solid' };

const sameFloats = (a: readonly number[] | null, b: readonly number[] | null): boolean => {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
};

interface StageSlot {
  id: StageId;
  floats: number[];
  shader: SkShader | null;
}

/**
 * One clip's shader chain: built once, stages remade only when their values change. Owned by the
 * `Compositor` (keyed by clip id).
 */
export class LayerChain {
  private readonly api: SkiaApi;
  private readonly retire: (o: Disposable) => void;
  private readonly cache: EffectCache;
  private sourceImage: SkImage | null = null;
  private sourceShader: SkShader | null = null;
  private solidKey = '';
  private stages: StageSlot[] = [];
  /** The source shader the current stages were built on. */
  private stagesInput: SkShader | null = null;
  private lutImage: SkImage | null = null;
  private lutShaderCache: { image: SkImage; shader: SkShader } | null = null;
  readonly paint: SkPaint;
  /** Only for `addition`: the opaque pass and the alpha-mask pass paints. */
  private addPaint: SkPaint | null = null;
  private maskPaint: SkPaint | null = null;
  private opaqueShader: SkShader | null = null;
  private opaqueOf: SkShader | null = null;
  blendMode: CompLayer['blendMode'] = 'normal';
  /** The chain's top shader (null: nothing to draw). */
  top: SkShader | null = null;
  /** Shaders made over the chain's lifetime (the tests' "no rebuild per frame" probe). */
  made = 0;
  /** The inputs of the last `update` (identical inputs: nothing to plan, MA62 S4). */
  private lastLayer: CompLayer | null = null;
  private lastSrc: SkImage | null = null;
  private lastLut: SkImage | null = null;
  private lastW = 0;
  private lastH = 0;
  /** The full-canvas rect, cached per size (a plain object: no host object per frame). */
  private rect = { x: 0, y: 0, width: 0, height: 0 };

  constructor(api: SkiaApi, retire: (o: Disposable) => void, cache: EffectCache) {
    this.api = api;
    this.retire = retire;
    this.cache = cache;
    this.paint = api.Paint();
    this.paint.setAntiAlias(false);
  }

  private make(stage: StageId, floats: number[], children: SkShader[]): SkShader {
    this.made += 1;
    return effectFor(this.api, stage, this.cache).makeShaderWithChildren(floats, children);
  }

  private setSource(src: LayerSource, layer: CompLayer): SkShader | null {
    if (src.kind === 'image') {
      if (src.image !== this.sourceImage || !this.sourceShader) {
        if (this.sourceShader) this.retire(this.sourceShader);
        this.sourceImage = src.image;
        this.sourceShader = src.image.makeShaderOptions(CLAMP, CLAMP, FILTER_LINEAR, MIP_NONE);
        this.made += 1;
        this.solidKey = '';
        return this.sourceShader;
      }
      return this.sourceShader;
    }
    const rgb = layer.solid ?? [0, 0, 0];
    const key = rgb.join(',');
    if (key !== this.solidKey || !this.sourceShader) {
      if (this.sourceShader) this.retire(this.sourceShader);
      this.sourceImage = null;
      this.solidKey = key;
      this.sourceShader = this.api.Shader.MakeColor(
        this.api.Color(`rgba(${Math.round(rgb[0] * 255)},${Math.round(rgb[1] * 255)},${Math.round(rgb[2] * 255)},1)`),
      );
      this.made += 1;
    }
    return this.sourceShader;
  }

  /**
   * Brings the chain to `layer` at canvas size W x H. `lut`: the layer's LUT image (the compositor's
   * cache) or null. Returns false when the layer draws nothing (degenerate quad).
   */
  update(layer: CompLayer, src: LayerSource, W: number, H: number, lut: { image: SkImage; size: number; cols: number } | null): boolean {
    // The preview reuses the layer objects while nothing at the playhead animates: then the chain
    // is already right and planning it again would only allocate (decision 0).
    const srcImage = src.kind === 'image' ? src.image : null;
    const lutImage = lut ? lut.image : null;
    if (
      layer === this.lastLayer &&
      srcImage === this.lastSrc &&
      lutImage === this.lastLut &&
      W === this.lastW &&
      H === this.lastH &&
      this.top
    ) {
      return true;
    }
    this.lastLayer = layer;
    this.lastSrc = srcImage;
    this.lastLut = lutImage;
    this.lastW = W;
    this.lastH = H;
    const source = this.setSource(src, layer);
    const want = source ? planLayer(layer, W, H, lut) : null;
    if (!source || !want) {
      this.top = null;
      this.lastLayer = null;
      return false;
    }
    // The first stage that differs (or whose input changed) and everything above it is remade.
    let dirty = this.stagesInput !== source;
    if (lut && lut.image !== this.lutImage) {
      this.lutImage = lut.image;
      dirty = dirty || want.some((w) => w.id === 'lut');
    }
    const next: StageSlot[] = [];
    let input: SkShader = source;
    for (let i = 0; i < want.length; i += 1) {
      const w = want[i]!;
      const old = this.stages[i];
      if (!dirty && old && old.id === w.id && sameFloats(old.floats, w.floats) && old.shader) {
        next.push(old);
        input = old.shader;
        continue;
      }
      dirty = true;
      const children = w.id === 'lut' && lut ? [input, this.lutShader(lut.image)] : [input];
      const shader = this.make(w.id, w.floats, children);
      next.push({ id: w.id, floats: w.floats, shader });
      input = shader;
    }
    // Retire every old stage that is not reused.
    const kept = new Set(next.map((s) => s.shader));
    for (const s of this.stages) if (s.shader && !kept.has(s.shader)) this.retire(s.shader);
    this.stages = next;
    this.stagesInput = source;
    this.top = input;
    this.blendMode = layer.blendMode ?? 'normal';
    return true;
  }

  private lutShader(image: SkImage): SkShader {
    if (this.lutShaderCache?.image === image) return this.lutShaderCache.shader;
    if (this.lutShaderCache) this.retire(this.lutShaderCache.shader);
    const shader = image.makeShaderOptions(CLAMP, CLAMP, FILTER_NEAREST, MIP_NONE);
    this.made += 1;
    this.lutShaderCache = { image, shader };
    return shader;
  }

  /** Draws the layer onto `canvas` (the composite so far), blended per the web's BLEND SPEC. */
  draw(canvas: SkCanvas, W: number, H: number): void {
    const top = this.top;
    if (!top) return;
    const rect = this.rect;
    if (rect.width !== W || rect.height !== H) this.rect = { x: 0, y: 0, width: W, height: H };
    const mode = this.blendMode ?? 'normal';
    if (mode !== 'addition') {
      this.paint.setShader(top);
      this.paint.setBlendMode(SKIA_BLEND_FOR[mode]);
      canvas.drawRect(this.rect, this.paint);
      return;
    }
    // addition: b + a * (min(b + c, 1) - b), see shaders/blend.ts.
    if (!this.addPaint) {
      this.addPaint = this.api.Paint();
      this.addPaint.setAntiAlias(false);
      this.addPaint.setBlendMode(SK_BLEND.Plus);
      this.maskPaint = this.api.Paint();
      this.maskPaint.setAntiAlias(false);
      this.maskPaint.setBlendMode(SK_BLEND.DstIn);
    }
    if (this.opaqueOf !== top || !this.opaqueShader) {
      if (this.opaqueShader) this.retire(this.opaqueShader);
      this.opaqueShader = this.make('opaque', [], [top]);
      this.opaqueOf = top;
    }
    this.addPaint.setShader(this.opaqueShader);
    this.maskPaint!.setShader(top);
    canvas.saveLayer(null, this.rect, null, SAVE_LAYER_INIT_WITH_PREVIOUS);
    canvas.drawRect(this.rect, this.addPaint);
    canvas.drawRect(this.rect, this.maskPaint!);
    canvas.restore();
  }

  /** Releases everything the chain made (retired through the owner, since it may still be drawn). */
  release(): void {
    for (const s of this.stages) if (s.shader) this.retire(s.shader);
    this.stages = [];
    if (this.sourceShader) this.retire(this.sourceShader);
    if (this.lutShaderCache) this.retire(this.lutShaderCache.shader);
    if (this.opaqueShader) this.retire(this.opaqueShader);
    this.retire(this.paint);
    if (this.addPaint) this.retire(this.addPaint);
    if (this.maskPaint) this.retire(this.maskPaint);
    this.sourceShader = null;
    this.lutShaderCache = null;
    this.opaqueShader = null;
    this.top = null;
    this.lastLayer = null;
  }
}

/** One drawable layer this frame: the web's `GLLayer`, its chain key and its source. */
export interface FrameLayer {
  /** Stable per clip (the clip id; a dip's colour layer: `<clipId>:dip`). */
  key: string;
  layer: CompLayer;
  source: LayerSource | null;
}

export class Compositor {
  private readonly api: SkiaApi;
  private readonly effects: EffectCache = new Map();
  private chains = new Map<string, LayerChain>();
  private luts = new Map<string, { image: SkImage; size: number; cols: number }>();
  private retired: { o: Disposable; at: number }[] = [];
  private frame = 0;
  private bg: SkPaint | null = null;
  private seen = new Set<string>();
  private bgRect = { x: 0, y: 0, width: 0, height: 0 };

  constructor(api: SkiaApi) {
    this.api = api;
  }

  /** The web's `loadLut` / `hasLut`: a parsed cube as an atlas image, cached per key. */
  loadLut(key: string, lut: ParsedLut): void {
    if (this.luts.has(key)) return;
    const atlas = lutAtlas(lut);
    const image = this.api.Image.MakeRaster(
      { width: atlas.width, height: atlas.height, colorType: RGBA_8888, alphaType: ALPHA_OPAQUE },
      this.api.Data.fromBytes(atlas.bytes),
      atlas.width * 4,
    );
    if (image) this.luts.set(key, { image, size: atlas.size, cols: atlas.cols });
  }

  hasLut(key: string): boolean {
    return this.luts.has(key);
  }

  /**
   * Hands `o` to the compositor to dispose `RETIRE_FRAMES` frames from now (a replaced frame
   * picture the canvas may still be drawing, a title picture whose clip changed).
   */
  retire(o: Disposable | null | undefined): void {
    if (o) this.retired.push({ o, at: this.frame });
  }

  /** The compiled effect of a stage (the parity suite pins the uniform layouts through this). */
  effect(stage: StageId): SkRuntimeEffect {
    return effectFor(this.api, stage, this.effects);
  }

  /**
   * Draws the layers (bottom to top) onto `canvas` at W x H: opaque black, then each layer through
   * its chain. Chains of clips no longer present are released (retired).
   */
  draw(canvas: SkCanvas, layers: readonly FrameLayer[], W: number, H: number): void {
    if (!this.bg) {
      this.bg = this.api.Paint();
      this.bg.setColor(this.api.Color('black'));
      this.bg.setBlendMode(SK_BLEND.Src);
    }
    if (this.bgRect.width !== W || this.bgRect.height !== H) this.bgRect = { x: 0, y: 0, width: W, height: H };
    canvas.drawRect(this.bgRect, this.bg);
    const seen = this.seen;
    seen.clear();
    for (const f of layers) {
      if (!f.source) continue;
      seen.add(f.key);
      let chain = this.chains.get(f.key);
      if (!chain) {
        chain = new LayerChain(this.api, (o) => this.retire(o), this.effects);
        this.chains.set(f.key, chain);
      }
      const lut = f.layer.lut ? (this.luts.get(f.layer.lut.key) ?? null) : null;
      if (chain.update(f.layer, f.source, W, H, lut)) chain.draw(canvas, W, H);
    }
    for (const [key, chain] of this.chains) {
      if (seen.has(key)) continue;
      chain.release();
      this.chains.delete(key);
    }
  }

  /** Call once per presented frame: disposes what was retired `RETIRE_FRAMES` frames ago. */
  endFrame(): void {
    this.frame += 1;
    if (!this.retired.length) return;
    const keep: { o: Disposable; at: number }[] = [];
    for (const r of this.retired) {
      if (this.frame - r.at >= RETIRE_FRAMES) disposeOne(r.o);
      else keep.push(r);
    }
    this.retired = keep;
  }

  /** The live chain of a clip (tests). */
  chainOf(key: string): LayerChain | undefined {
    return this.chains.get(key);
  }

  /** Releases every chain, LUT image and retired object now (unmount; nothing draws any more). */
  dispose(): void {
    for (const chain of this.chains.values()) chain.release();
    this.chains.clear();
    for (const r of this.retired) disposeOne(r.o);
    this.retired = [];
    for (const l of this.luts.values()) disposeOne(l.image);
    this.luts.clear();
    disposeOne(this.bg);
    this.bg = null;
  }
}

