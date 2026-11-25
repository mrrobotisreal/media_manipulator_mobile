/**
 * GPU object lifetimes on react-native-skia 3 (MA60). Graphite images and surfaces are GPU
 * textures, and v3 reports their size to Hermes only on the image/surface wrapper: a shader, paint
 * or picture that references a texture reports a few hundred bytes (`kMinMemoryPressure`,
 * `JsiSkShader.h`; `JsiSkPicture.h` counts only the picture's own ops). So the GC sees no reason to
 * collect the small wrappers that pin large textures, and an editor that leaves them to the GC grows
 * by a texture per render (measured on the S25: about 1 GB per slider burst with a dehaze layer).
 *
 * `dispose()` (`JsiSkNativeObjects.h`) drops the wrapper's own reference and marks THAT host object
 * disposed (any runtime that uses it afterwards throws). Whatever already holds the Skia object
 * natively (a shader built from an image, a picture recorded with a paint) keeps it alive. So:
 * dispose a wrapper once nothing in JS will touch it again; never dispose one that a canvas or a
 * running render may still read (`disposeLater` for anything that can be on screen).
 */

export interface Disposable {
  dispose?: () => void;
}

const disposeOne = (o: Disposable | null | undefined) => {
  try {
    o?.dispose?.();
  } catch {
    // already disposed, or a test double without dispose
  }
};

/** The objects one unit of work (a render, a readback) creates, released together. */
export class Scope {
  private items: Disposable[] = [];

  /** Adopt `o`: it is disposed by `release()`. Returns `o`. */
  own<T>(o: T): T {
    if (o && typeof o === 'object') this.items.push(o as Disposable);
    return o;
  }

  /** Dispose everything adopted, newest first. Safe to call twice. */
  release(): void {
    const xs = this.items;
    this.items = [];
    for (let i = xs.length - 1; i >= 0; i -= 1) disposeOne(xs[i]);
  }

  get size(): number {
    return this.items.length;
  }
}

/** How long a replaced picture / thumbnail stays alive: the UI thread may still draw it this frame. */
export const RETIRE_MS = 1000;

/** Dispose after `ms`: for objects a canvas may still be drawing (a replaced picture, a thumbnail). */
export function disposeLater(
  objs: readonly (Disposable | null | undefined)[],
  ms = RETIRE_MS,
): void {
  const live = objs.filter((o): o is Disposable => !!o);
  if (live.length === 0) return;
  setTimeout(() => live.forEach(disposeOne), ms);
}

export function disposeNow(objs: readonly (Disposable | null | undefined)[]): void {
  objs.forEach(disposeOne);
}
