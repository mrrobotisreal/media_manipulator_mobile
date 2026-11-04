/**
 * Builds the preview shader for a document: the source image, then one runtime shader per planned
 * layer, each taking the previous one as its `uSource` child. The Skia API is injected (the app
 * passes `Skia` from `@shopify/react-native-skia`; the parity test passes the same JSI API on
 * CanvasKit), so this file has no native import and runs in jest.
 *
 * Effects are compiled once per layer type per API instance (`RuntimeEffect.Make` is the expensive
 * call); curve and LUT textures are cached per params object (the store shares params structurally,
 * so an untouched layer keeps its texture across slider ticks).
 */
import type {
  SkImage,
  SkRuntimeEffect,
  SkShader,
  Skia as SkiaApiValue,
} from '@shopify/react-native-skia';
import type { AdjustmentLayer } from '../photoTypes';
import { childNames, layerSksl, type SkslLayerType } from './shaders/adjust';
import { packSkslLayer, planSkslLayers, type RgbaTexture } from './uniforms';

export type SkiaApi = typeof SkiaApiValue;

// Numeric enum values (TileMode.Clamp, FilterMode, MipmapMode, ColorType.RGBA_8888, AlphaType):
// a pure module must not import RN Skia at runtime (jest has no native module).
const CLAMP = 0;
const FILTER_NEAREST = 0;
const FILTER_LINEAR = 1;
const MIP_NONE = 0;
const RGBA_8888 = 4;
const ALPHA_OPAQUE = 1;

export type SourceSampling = 'exact' | 'smooth';

const effects = new WeakMap<object, Map<SkslLayerType, SkRuntimeEffect>>();
const textures = new WeakMap<object, WeakMap<object, SkImage>>();

export class ShaderCompileError extends Error {
  constructor(readonly type: SkslLayerType) {
    super(`SkSL for ${type} did not compile`);
    this.name = 'ShaderCompileError';
  }
}

/** The compiled effect for a layer type (cached per API instance). */
export function effectFor(api: SkiaApi, type: SkslLayerType): SkRuntimeEffect {
  let byType = effects.get(api);
  if (!byType) {
    byType = new Map();
    effects.set(api, byType);
  }
  let e = byType.get(type);
  if (!e) {
    const made = api.RuntimeEffect.Make(layerSksl(type));
    if (!made) throw new ShaderCompileError(type);
    e = made;
    byType.set(type, e);
  }
  return e;
}

function textureImage(api: SkiaApi, key: object, tex: RgbaTexture): SkImage | null {
  let byKey = textures.get(api);
  if (!byKey) {
    byKey = new WeakMap();
    textures.set(api, byKey);
  }
  const hit = byKey.get(key);
  if (hit) return hit;
  const img = api.Image.MakeImage(
    { width: tex.width, height: tex.height, colorType: RGBA_8888, alphaType: ALPHA_OPAQUE },
    api.Data.fromBytes(tex.bytes),
    tex.width * 4,
  );
  if (img) byKey.set(key, img);
  return img;
}

const exactShader = (img: SkImage) => img.makeShaderOptions(CLAMP, CLAMP, FILTER_NEAREST, MIP_NONE);

/** The source image as a shader in its own pixel coordinates. */
export function sourceShader(image: SkImage, sampling: SourceSampling = 'smooth'): SkShader {
  // `exact` (parity tests): one texel per pixel. `smooth` (the screen, readback): bilinear between
  // texels; no mipmaps (a decoded image has none, and the preview is at most 8 MP).
  return sampling === 'exact'
    ? exactShader(image)
    : image.makeShaderOptions(CLAMP, CLAMP, FILTER_LINEAR, MIP_NONE);
}

/**
 * Wraps `input` in one shader per planned layer. Unplanned layers (rung 4) are skipped. `maskFor`
 * (MA51) gives a layer's finished mask as a shader (value in `.r`), or null when it has none.
 */
export function chainShaders(
  api: SkiaApi,
  input: SkShader,
  layers: readonly AdjustmentLayer[],
  maskFor?: (layer: AdjustmentLayer) => SkShader | null,
): SkShader {
  const ones = api.Shader.MakeColor(api.Color('white'));
  let cur = input;
  for (const layer of planSkslLayers(layers)) {
    const mask = maskFor?.(layer) ?? null;
    const packed = packSkslLayer(layer, mask !== null);
    if (!packed) continue;
    const children: SkShader[] = [cur, mask ?? ones];
    if (packed.curves) {
      const img = textureImage(api, layer.params, packed.curves);
      if (!img) continue;
      children.push(exactShader(img));
    }
    if (layer.type === 'lut') {
      // No usable cube: the web treats the layer as the identity; so does the phone.
      const img = packed.lut ? textureImage(api, layer.params, packed.lut) : null;
      if (!img) continue;
      children.push(exactShader(img));
    }
    if (children.length !== childNames(packed.type).length) continue;
    cur = effectFor(api, packed.type).makeShaderWithChildren(packed.uniforms, children);
  }
  return cur;
}

/** Source + every planned layer: what the canvas paints. */
export function buildDocShader(
  api: SkiaApi,
  image: SkImage,
  layers: readonly AdjustmentLayer[],
  sampling: SourceSampling = 'smooth',
): SkShader {
  return chainShaders(api, sourceShader(image, sampling), layers);
}
