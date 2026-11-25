/**
 * Test helper (MA60 leak test): wraps the Skia API so every surface, image and picture it hands out
 * is counted, and `dispose()` on one is counted too. `live()` is what has been made and not yet
 * disposed. Images made by a surface snapshot and pictures made by a recorder are tracked as well.
 */
import type { SkiaApi } from '../shaderChain';

export interface Counts {
  surfaces: number;
  images: number;
  pictures: number;
}

export function countingApi(api: SkiaApi) {
  const live = new Set<object>();
  const kind = new WeakMap<object, keyof Counts>();
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
    if (k === 'surfaces') {
      const s = obj as unknown as { makeImageSnapshot: (...a: unknown[]) => unknown };
      const snap = s.makeImageSnapshot.bind(s);
      s.makeImageSnapshot = (...a: unknown[]) => track(snap(...a), 'images');
    }
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
    const finish = rec.finishRecordingAsPicture.bind(rec);
    rec.finishRecordingAsPicture = () => track(finish(), 'pictures');
    return rec;
  };
  const wrapped = new Proxy(api, {
    get(target, prop, recv) {
      if (prop === 'Surface') return Surface;
      if (prop === 'Image') return Image;
      if (prop === 'PictureRecorder') return PictureRecorder;
      return Reflect.get(target, prop, recv);
    },
  }) as SkiaApi;
  return {
    api: wrapped,
    live(): Counts {
      const c: Counts = { surfaces: 0, images: 0, pictures: 0 };
      for (const o of live) c[kind.get(o)!] += 1;
      return c;
    },
    total(): number {
      return live.size;
    },
  };
}
