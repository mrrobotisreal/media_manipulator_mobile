/**
 * Test helper (MA60 leak test): wraps the Skia API so every wrapper that can pin a GPU texture is
 * counted while it is alive (made and not yet disposed):
 * - surfaces (`Surface.MakeRaster` / `MakeOffscreen`) and images (`Image.MakeRaster`,
 *   `MakeFromEncoded`, surface snapshots);
 * - pictures (recorders' `finishRecordingAsPicture`);
 * - shaders: image shaders (`makeShaderOptions` / `makeShader*` of any image the API hands out, or
 *   that a test `watch()`es), runtime shaders (`makeShaderWithChildren` / `makeShader` of an effect
 *   from `RuntimeEffect.Make`) and `Shader.*` factory shaders. On react-native-skia 3 a shader
 *   built from an image keeps that image's texture alive natively and reports ~256 bytes to Hermes,
 *   so an undisposed shader pins a texture until a GC nothing triggers;
 * - paints (`Paint()`: a paint holds its shader and image filter) and image filters
 *   (`ImageFilter.*`).
 */
import type { SkiaApi } from '../shaderChain';

export interface Counts {
  surfaces: number;
  images: number;
  pictures: number;
  shaders: number;
  paints: number;
  imageFilters: number;
}

const ZERO: Counts = { surfaces: 0, images: 0, pictures: 0, shaders: 0, paints: 0, imageFilters: 0 };

type Fn = (...a: unknown[]) => unknown;

export function countingApi(api: SkiaApi) {
  const live = new Set<object>();
  const kind = new WeakMap<object, keyof Counts>();
  const watched = new WeakSet<object>();

  /** Patch `obj[name]` so whatever it returns is tracked as `k`. */
  const wrapMethods = (obj: object, names: readonly string[], k: keyof Counts) => {
    const o = obj as Record<string, unknown>;
    for (const name of names) {
      const fn = o[name];
      if (typeof fn !== 'function') continue;
      const bound = (fn as Fn).bind(obj);
      o[name] = (...a: unknown[]) => track(bound(...a), k);
    }
  };

  /** Track the shaders an image makes, without counting the image itself. */
  const watchImage = <T>(img: T): T => {
    if (!img || typeof img !== 'object' || watched.has(img)) return img;
    watched.add(img);
    wrapMethods(img, ['makeShaderOptions', 'makeShaderCubic', 'makeShader'], 'shaders');
    return img;
  };

  const track = <T>(o: T, k: keyof Counts): T => {
    if (!o || typeof o !== 'object') return o;
    const obj = o as unknown as { dispose?: () => void };
    if (kind.has(obj)) return o;
    kind.set(obj, k);
    live.add(obj);
    const original = obj.dispose?.bind(obj);
    obj.dispose = () => {
      live.delete(obj);
      original?.();
    };
    if (k === 'surfaces') wrapMethods(obj, ['makeImageSnapshot'], 'images');
    if (k === 'images') watchImage(obj);
    return o;
  };

  const Surface = {
    ...api.Surface,
    MakeRaster: (w: number, h: number) => track(api.Surface.MakeRaster(w, h), 'surfaces'),
    MakeOffscreen: (w: number, h: number) => track(api.Surface.MakeRaster(w, h), 'surfaces'),
  };
  const Image = {
    ...api.Image,
    MakeRaster: (...a: Parameters<SkiaApi['Image']['MakeRaster']>) =>
      track(api.Image.MakeRaster(...a), 'images'),
    MakeFromEncoded: (...a: Parameters<SkiaApi['Image']['MakeFromEncoded']>) =>
      track(api.Image.MakeFromEncoded(...a), 'images'),
  };
  const PictureRecorder = () => {
    const rec = api.PictureRecorder();
    wrapMethods(rec, ['finishRecordingAsPicture'], 'pictures');
    return rec;
  };
  const RuntimeEffect = {
    ...api.RuntimeEffect,
    Make: (src: string) => {
      const e = api.RuntimeEffect.Make(src);
      if (e) wrapMethods(e, ['makeShaderWithChildren', 'makeShader'], 'shaders');
      return e;
    },
  };
  /** Every function of a factory object returns a tracked `k`. */
  const factory = <F extends object>(f: F, k: keyof Counts): F =>
    new Proxy(f, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv) as unknown;
        if (typeof v !== 'function') return v;
        return (...a: unknown[]) => track((v as Fn).apply(target, a), k);
      },
    });
  const Shader = factory(api.Shader, 'shaders');
  const ImageFilter = factory(api.ImageFilter, 'imageFilters');
  const Paint = () => track(api.Paint(), 'paints');

  const wrapped = new Proxy(api, {
    get(target, prop, recv) {
      if (prop === 'Surface') return Surface;
      if (prop === 'Image') return Image;
      if (prop === 'PictureRecorder') return PictureRecorder;
      if (prop === 'RuntimeEffect') return RuntimeEffect;
      if (prop === 'Shader') return Shader;
      if (prop === 'ImageFilter') return ImageFilter;
      if (prop === 'Paint') return Paint;
      return Reflect.get(target, prop, recv);
    },
  }) as SkiaApi;
  return {
    api: wrapped,
    /** Count the shaders made from an image the API did not hand out (a test fixture). */
    watch: watchImage,
    live(): Counts {
      const c: Counts = { ...ZERO };
      for (const o of live) c[kind.get(o)!] += 1;
      return c;
    },
    total(): number {
      return live.size;
    },
  };
}
