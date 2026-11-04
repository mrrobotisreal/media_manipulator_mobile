// DO NOT EDIT. Copied from media-manipulator-ui lib/photo/gl/histogram.ts by scripts/sync-photo-fixtures.mjs
// (npm run photo:sync). The web repo is the source of the model and the math (ADR MA-0010);
// it is type-checked and linted there, under its own settings (eslint.config.js ignores these).
// @ts-nocheck
/**
 * RGB + luma histogram of an RGBA8 buffer. `computeHistogram` is pure (tested);
 * `HistogramWorker` runs the same source in a Web Worker (blob URL) so the
 * editor can feed it `PhotoRenderer.readPixels()` every 200 ms without
 * blocking the main thread, falling back in-process when Workers are missing.
 */
export interface Histogram {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  luma: Uint32Array;
  /** Highest bin count across channels (for scaling the plot). */
  max: number;
}

export function computeHistogram(rgba: Uint8Array | Uint8ClampedArray): Histogram {
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  const luma = new Uint32Array(256);
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    const R = rgba[i];
    const G = rgba[i + 1];
    const B = rgba[i + 2];
    r[R] += 1;
    g[G] += 1;
    b[B] += 1;
    luma[Math.min(255, Math.round(0.2126 * R + 0.7152 * G + 0.0722 * B))] += 1;
  }
  let max = 0;
  for (let i = 0; i < 256; i += 1) max = Math.max(max, r[i], g[i], b[i], luma[i]);
  return { r, g, b, luma, max };
}

const WORKER_SOURCE = `self.onmessage = (e) => {
  const rgba = new Uint8Array(e.data.buffer);
  const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), l = new Uint32Array(256);
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    const R = rgba[i], G = rgba[i + 1], B = rgba[i + 2];
    r[R]++; g[G]++; b[B]++;
    l[Math.min(255, Math.round(0.2126 * R + 0.7152 * G + 0.0722 * B))]++;
  }
  self.postMessage({ id: e.data.id, r, g, b, l }, [r.buffer, g.buffer, b.buffer, l.buffer]);
};`;

export interface HistogramPort {
  compute(rgba: Uint8Array): Promise<Histogram>;
  dispose(): void;
}

function finish(r: Uint32Array, g: Uint32Array, b: Uint32Array, luma: Uint32Array): Histogram {
  let max = 0;
  for (let i = 0; i < 256; i += 1) max = Math.max(max, r[i], g[i], b[i], luma[i]);
  return { r, g, b, luma, max };
}

export function inProcessHistogramPort(): HistogramPort {
  return { compute: async (rgba) => computeHistogram(rgba), dispose() {} };
}

export function workerHistogramPort(): HistogramPort {
  let worker: Worker;
  let url: string;
  try {
    url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
    worker = new Worker(url, { name: 'photo-histogram' });
  } catch {
    return inProcessHistogramPort();
  }
  let seq = 0;
  const waiting = new Map<number, (h: Histogram) => void>();
  worker.onmessage = (e: MessageEvent<{ id: number; r: Uint32Array; g: Uint32Array; b: Uint32Array; l: Uint32Array }>) => {
    const d = e.data;
    waiting.get(d.id)?.(finish(d.r, d.g, d.b, d.l));
    waiting.delete(d.id);
  };
  return {
    compute(rgba) {
      return new Promise((resolve) => {
        const id = (seq += 1);
        waiting.set(id, resolve);
        // Copy so the caller keeps its buffer; the copy is transferred.
        const copy = rgba.slice();
        worker.postMessage({ id, buffer: copy.buffer }, [copy.buffer]);
      });
    },
    dispose() {
      worker.terminate();
      URL.revokeObjectURL(url);
      waiting.clear();
    },
  };
}
