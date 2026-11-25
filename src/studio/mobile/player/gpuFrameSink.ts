/**
 * The GPU side of the frame pump (ticket MA62 decision 0, MA76's fixed loop): copies a decoded
 * `NativeVideoFrame` into the slot's texture on the shared Dawn device
 * (`queue.copyExternalImageToTexture`, which renders through an external texture: YUV -> RGB and
 * rotation) and releases the frame right after the copy is queued, also when it throws.
 *
 * MA76's rules, all here:
 * - one texture and ONE `SkImage` per slot (`Skia.Image.MakeFromGPUTexture`), made when the texture
 *   is created or resized and disposed with it; every later frame overwrites the same texture, and
 *   the canvas redraws because the pump bumps a numeric `redraw` the scene reads;
 * - the copy descriptors are preallocated per slot and mutated in place (no object per frame);
 * - an image replaced by a resize is retired, not disposed at once: the canvas may still draw it
 *   this frame (MA60 rule). It is disposed `RETIRE_FRAMES` frames later, with its texture.
 *
 * Runs on the UI runtime (`installWebGPU()` once per runtime is the caller's job). The device, the
 * texture format and the Skia API are injected, so jest drives it with a counting fake.
 */
import type { FrameSink } from './framePump';
import type { PreviewFrame } from './types';
import { SLOT_COUNT } from './types';

/** GPUTextureUsage.COPY_SRC | COPY_DST | TEXTURE_BINDING | RENDER_ATTACHMENT (MA76: 0x10 | 0x04 | 0x01 + render). */
export const SLOT_TEXTURE_USAGE = 0x01 | 0x02 | 0x04 | 0x10;

/** A replaced image and texture are disposed this many frames later. */
export const RETIRE_FRAMES = 30;

export interface SinkTexture {
  readonly width: number;
  readonly height: number;
  destroy(): void;
}

export interface SinkDevice {
  createTexture(desc: { size: [number, number]; format: string; usage: number }): SinkTexture;
  queue: {
    copyExternalImageToTexture(src: unknown, dst: unknown, size: unknown): void;
  };
}

export interface SinkImage {
  dispose(): void;
}

export interface SinkSkia {
  Image: { MakeFromGPUTexture(texture: SinkTexture): SinkImage };
}

interface CopyDesc {
  src: { source: PreviewFrame | null; rotation: number };
  dst: { texture: SinkTexture | null };
  size: [number, number];
}

export interface GpuFrameSink extends FrameSink {
  /** The image per slot the scene draws (null before the first frame). */
  readonly images: (SinkImage | null)[];
  /** Bumped when any slot's image object changed (the scene re-reads `images`). */
  imageGen(): number;
  /** Call once per frame, after the pump: disposes retired images / textures that are due. */
  endFrame(): void;
  /** Release everything (unmount, device lost). */
  dispose(): void;
}

export function createGpuFrameSink(device: SinkDevice, format: string, skia: SinkSkia): GpuFrameSink {
  'worklet';
  const textures: (SinkTexture | null)[] = [];
  const images: (SinkImage | null)[] = [];
  const descs: CopyDesc[] = [];
  for (let i = 0; i < SLOT_COUNT; i += 1) {
    textures.push(null);
    images.push(null);
    descs.push({ src: { source: null, rotation: 0 }, dst: { texture: null }, size: [0, 0] });
  }
  // Retire ring: fixed capacity; a resize is rare (a new clip of another size).
  const RING = 16;
  const retiredImg: (SinkImage | null)[] = [];
  const retiredTex: (SinkTexture | null)[] = [];
  const retiredAt: number[] = [];
  for (let k = 0; k < RING; k += 1) {
    retiredImg.push(null);
    retiredTex.push(null);
    retiredAt.push(0);
  }
  // Mutable counters live in an object: a worklet closure captures variables by value, so a
  // reassigned `let` would not survive across calls; fields of a captured object do.
  const n = { frame: 0, gen: 0 };

  const disposeAt = (k: number) => {
    'worklet';
    try {
      retiredImg[k]?.dispose();
    } catch {
      // already disposed
    }
    try {
      retiredTex[k]?.destroy();
    } catch {
      // already destroyed
    }
    retiredImg[k] = null;
    retiredTex[k] = null;
  };

  const retire = (img: SinkImage | null, tex: SinkTexture | null) => {
    'worklet';
    if (!img && !tex) return;
    let slot = -1;
    for (let k = 0; k < RING; k += 1) {
      if (!retiredImg[k] && !retiredTex[k]) {
        slot = k;
        break;
      }
    }
    if (slot < 0) {
      // Full (16 resizes inside RETIRE_FRAMES): dispose the oldest now.
      let oldest = 0;
      for (let k = 1; k < RING; k += 1) if (retiredAt[k]! < retiredAt[oldest]!) oldest = k;
      disposeAt(oldest);
      slot = oldest;
    }
    retiredImg[slot] = img;
    retiredTex[slot] = tex;
    retiredAt[slot] = n.frame;
  };

  const sink: GpuFrameSink = {
    images,
    imageGen() {
      'worklet';
      return n.gen;
    },
    copy(slot, frame, rotation) {
      'worklet';
      const d = descs[slot]!;
      try {
        const rotated = rotation === 90 || rotation === 270;
        const w = rotated ? frame.height : frame.width;
        const h = rotated ? frame.width : frame.height;
        let t = textures[slot];
        if (!t || t.width !== w || t.height !== h) {
          retire(images[slot]!, t ?? null);
          images[slot] = null;
          t = device.createTexture({ size: [w, h], format, usage: SLOT_TEXTURE_USAGE });
          textures[slot] = t;
          d.dst.texture = t;
          d.size[0] = w;
          d.size[1] = h;
          images[slot] = skia.Image.MakeFromGPUTexture(t);
          n.gen += 1;
        }
        d.src.source = frame;
        d.src.rotation = rotation;
        device.queue.copyExternalImageToTexture(d.src, d.dst, d.size);
        return true;
      } catch {
        return false;
      } finally {
        d.src.source = null;
        frame.release();
      }
    },
    endFrame() {
      'worklet';
      n.frame += 1;
      for (let k = 0; k < RING; k += 1) {
        if ((retiredImg[k] || retiredTex[k]) && n.frame - retiredAt[k]! >= RETIRE_FRAMES) disposeAt(k);
      }
    },
    dispose() {
      'worklet';
      for (let k = 0; k < RING; k += 1) disposeAt(k);
      for (let i = 0; i < SLOT_COUNT; i += 1) {
        try {
          images[i]?.dispose();
        } catch {
          // already disposed
        }
        try {
          textures[i]?.destroy();
        } catch {
          // already destroyed
        }
        images[i] = null;
        textures[i] = null;
        descs[i]!.dst.texture = null;
      }
      n.gen += 1;
    },
  };
  return sink;
}
