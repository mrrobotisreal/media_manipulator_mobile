/**
 * The per-frame path's MA76 rules, checked without a device: the GPU sink reuses one texture, one
 * SkImage and one set of copy descriptors per slot, releases every frame (also on a failed copy)
 * and retires replaced images instead of disposing them under the canvas; the pump's per-frame
 * function contains no allocating construct.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGpuFrameSink, RETIRE_FRAMES, type SinkDevice, type SinkSkia, type SinkTexture } from '../gpuFrameSink';

function fakeGpu() {
  const live = { textures: 0, images: 0 };
  const copies: { src: unknown; dst: unknown; size: unknown }[] = [];
  let failNext = false;
  const device: SinkDevice = {
    createTexture({ size }) {
      live.textures += 1;
      let gone = false;
      return {
        width: size[0],
        height: size[1],
        destroy() {
          if (!gone) live.textures -= 1;
          gone = true;
        },
      };
    },
    queue: {
      copyExternalImageToTexture(src, dst, size) {
        if (failNext) {
          failNext = false;
          throw new Error('device lost');
        }
        copies.push({ src, dst, size });
      },
    },
  };
  const skia: SinkSkia = {
    Image: {
      MakeFromGPUTexture(_t: SinkTexture) {
        live.images += 1;
        let gone = false;
        return {
          dispose() {
            if (!gone) live.images -= 1;
            gone = true;
          },
        };
      },
    },
  };
  return { device, skia, live, copies, failNext: () => (failNext = true) };
}

const frame = (w = 1280, h = 720) => {
  const f = { width: w, height: h, released: false, release: () => (f.released = true) };
  return f;
};

describe('GPU frame sink (MA76 rules)', () => {
  it('one texture, one image, one descriptor set per slot across frames', () => {
    const g = fakeGpu();
    const sink = createGpuFrameSink(g.device, 'rgba8unorm', g.skia);
    for (let k = 0; k < 120; k += 1) {
      for (const slot of [0, 1]) expect(sink.copy(slot, frame(), 0)).toBe(true);
      sink.endFrame();
    }
    expect(g.live).toEqual({ textures: 2, images: 2 });
    expect(sink.imageGen()).toBe(2);
    const slot0 = g.copies.filter((_, i) => i % 2 === 0);
    expect(new Set(slot0.map((c) => c.src)).size).toBe(1);
    expect(new Set(slot0.map((c) => c.dst)).size).toBe(1);
    expect(new Set(slot0.map((c) => c.size)).size).toBe(1);
    // The descriptor does not keep the frame after the copy.
    expect((slot0[0]!.src as { source: unknown }).source).toBeNull();
  });

  it('releases every frame, also when the copy throws', () => {
    const g = fakeGpu();
    const sink = createGpuFrameSink(g.device, 'rgba8unorm', g.skia);
    const a = frame();
    sink.copy(0, a, 0);
    g.failNext();
    const b = frame();
    expect(sink.copy(0, b, 0)).toBe(false);
    expect([a.released, b.released]).toEqual([true, true]);
  });

  it('a rotated portrait frame gets an upright texture', () => {
    const g = fakeGpu();
    const sink = createGpuFrameSink(g.device, 'rgba8unorm', g.skia);
    sink.copy(0, frame(1280, 720), 90);
    expect((g.copies[0]!.size as number[]).slice()).toEqual([720, 1280]);
  });

  it('a resize retires the old image and texture for RETIRE_FRAMES frames, then disposes them', () => {
    const g = fakeGpu();
    const sink = createGpuFrameSink(g.device, 'rgba8unorm', g.skia);
    sink.copy(0, frame(1280, 720), 0);
    const first = sink.images[0];
    sink.copy(0, frame(640, 360), 0);
    expect(sink.images[0]).not.toBe(first);
    expect(g.live).toEqual({ textures: 2, images: 2 }); // the old pair is still drawable
    for (let k = 0; k < RETIRE_FRAMES - 1; k += 1) sink.endFrame();
    expect(g.live.images).toBe(2);
    sink.endFrame();
    expect(g.live).toEqual({ textures: 1, images: 1 });
  });

  it('dispose releases everything, retired included', () => {
    const g = fakeGpu();
    const sink = createGpuFrameSink(g.device, 'rgba8unorm', g.skia);
    for (const [w, h] of [[1280, 720], [640, 360], [1920, 1080]] as const) sink.copy(0, frame(w, h), 0);
    sink.copy(1, frame(), 0);
    sink.dispose();
    expect(g.live).toEqual({ textures: 0, images: 0 });
    expect(sink.images.every((x) => x === null)).toBe(true);
  });
});

describe('framePump.pumpFrame allocates nothing per frame', () => {
  it('its body has no object / array literal, closure, spread or allocating call', () => {
    const src = readFileSync(join(__dirname, '..', 'framePump.ts'), 'utf8');
    const start = src.indexOf('export function pumpFrame(');
    expect(start).toBeGreaterThan(0);
    const body = src.slice(src.indexOf('{', src.indexOf(')', src.indexOf('nowMs: number', start))), src.length);
    const code = body.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/[=(,:]\s*\{/); // object literal
    expect(code).not.toMatch(/[=(,:]\s*\[/); // array literal
    expect(code).not.toMatch(/=>|function\s*\(/); // closure
    expect(code).not.toMatch(/\.\.\./);
    expect(code).not.toMatch(/\bnew\s/);
    expect(code).not.toMatch(/\.(slice|map|filter|concat|reduce|forEach|splice)\(/);
    expect(code).not.toMatch(/`/); // template string
    expect(code).not.toMatch(/console\./); // no per-frame logging (MA76 fix 3)
  });
});
