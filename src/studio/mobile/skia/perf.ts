/**
 * Darkroom preview perf telemetry (ticket MA62 decision 12, decision 0 rule 5): `studio_perf_sample`
 * aggregated over 60 s windows while playing, never per frame. The web's shape and buckets (ADR
 * ws/0003; `media-manipulator-ui/lib/studio/telemetry.ts` `flushPerfSample`, buckets from
 * `lib/analytics/buckets.ts`, restated here because the web file imports its analytics client)
 * plus the app's catalog-first props (batch "MA62 darkroom"): `slots`, `safeMode`, `deviceClass`,
 * `jsHeapMbBucket`.
 *
 * Memory: TOTAL PSS (what MA76 measured) needs `Debug.getMemoryInfo`, a native module; the only
 * figure JS can read is the Hermes heap (`HermesInternal.getInstrumentedStats().js_heapSize`), so
 * that is what `jsHeapMbBucket` carries. Graphics and native creep stay a `dumpsys meminfo` check.
 *
 * Pure: the clock, the heap reader and the sender are injected; the preview's JS timer calls
 * `sample()` about once a second with the frame counters it read from the UI runtime.
 */
import type { StudioPerfSampleProps } from '@/analytics/events';

export const PERF_WINDOW_MS = 60_000;
/** Samples kept per window (one a second: a minute, with headroom). */
const MAX_SAMPLES = 120;

// --- The web's buckets (lib/analytics/buckets.ts), byte-for-byte boundaries ----------------------
export function fpsBucket(fps: number): string {
  if (fps < 15) return '<15';
  if (fps < 30) return '15-30';
  if (fps < 45) return '30-45';
  if (fps < 55) return '45-55';
  return '55+';
}
export function droppedFrameRatioBucket(ratio: number): string {
  if (ratio <= 0) return '0';
  if (ratio < 0.01) return '<1%';
  if (ratio < 0.05) return '1-5%';
  if (ratio < 0.15) return '5-15%';
  return '15%+';
}
export function latencyMsBucket(ms: number): string {
  if (ms < 50) return '<50ms';
  if (ms < 200) return '50-200ms';
  if (ms < 500) return '200-500ms';
  if (ms < 1000) return '500ms-1s';
  return '1s+';
}
export function countBucket(n: number): string {
  if (n <= 0) return '0';
  if (n <= 10) return '1-10';
  if (n <= 50) return '11-50';
  if (n <= 200) return '51-200';
  return '200+';
}

// --- The app's props --------------------------------------------------------------------------
export type DeviceClass = StudioPerfSampleProps['deviceClass'];

/** Total RAM in bytes (`expo-device` `totalMemory`) -> < 4 GB low, < 8 GB mid, else high. */
export function deviceClassOf(totalMemory: number | null | undefined): DeviceClass {
  if (!totalMemory || !(totalMemory > 0)) return 'unknown';
  const gb = totalMemory / 1024 ** 3;
  if (gb < 4) return 'low';
  if (gb < 8) return 'mid';
  return 'high';
}

export function jsHeapMbBucket(bytes: number | null | undefined): StudioPerfSampleProps['jsHeapMbBucket'] {
  if (bytes === null || bytes === undefined || !(bytes >= 0)) return undefined;
  const mb = bytes / 1048576;
  if (mb < 64) return '<64';
  if (mb < 128) return '64-128';
  if (mb < 256) return '128-256';
  if (mb < 512) return '256-512';
  return '512+';
}

/** The Hermes heap of this JS runtime, or null off Hermes. */
export function hermesHeapBytes(): number | null {
  const h = (globalThis as { HermesInternal?: { getInstrumentedStats?: () => { js_heapSize?: number } } })
    .HermesInternal;
  const n = h?.getInstrumentedStats?.()?.js_heapSize;
  return typeof n === 'number' ? n : null;
}

/** Nearest-rank percentile (the web's `percentile`). */
function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank]!;
}

export interface PerfDeps {
  send(props: StudioPerfSampleProps): void;
  heapBytes(): number | null;
  deviceClass: DeviceClass;
  /** `gpuEditors() === 'unavailable'` (the web's `webglFallback`). */
  gpuUnavailable(): boolean;
}

export interface PerfInput {
  nowMs: number;
  playing: boolean;
  /** Frames presented in the last window (the composited redraw counter's delta). */
  fps: number;
  /** Frames the project cadence expected but no slot delivered, over the expected count. */
  droppedRatio: number;
  /** Decoding video slots right now. */
  slots: number;
  safeMode: boolean;
  /** New landed-seek latencies (ms) since the last sample. */
  seekLatenciesMs?: readonly number[];
  /** Counted events since the last sample. */
  resyncSeeks?: number;
  stuckRecoveries?: number;
}

/**
 * The rolling window. `sample()` records while playing and flushes a `studio_perf_sample` once
 * `PERF_WINDOW_MS` of playing time is in; `flush()` sends what is there (unmount, background).
 */
export class PerfAggregator {
  private fps: number[] = [];
  private dropped: number[] = [];
  private seeks: number[] = [];
  private resync = 0;
  private stuck = 0;
  private maxSlots = 0;
  private safe = false;
  private playedMs = 0;
  private lastMs: number | null = null;
  /** Samples sent (tests). */
  sent = 0;

  constructor(private readonly deps: PerfDeps) {}

  sample(i: PerfInput): void {
    if (i.seekLatenciesMs) for (const v of i.seekLatenciesMs) this.push(this.seeks, v);
    this.resync += i.resyncSeeks ?? 0;
    this.stuck += i.stuckRecoveries ?? 0;
    const dt = this.lastMs === null ? 0 : Math.max(0, i.nowMs - this.lastMs);
    this.lastMs = i.nowMs;
    if (!i.playing) return;
    this.playedMs += dt;
    this.push(this.fps, i.fps);
    this.push(this.dropped, i.droppedRatio);
    this.maxSlots = Math.max(this.maxSlots, i.slots);
    this.safe = i.safeMode;
    if (this.playedMs >= PERF_WINDOW_MS) this.flush();
  }

  /** Sends the window (if anything was recorded) and starts a new one. */
  flush(): void {
    const has = this.fps.length > 0 || this.seeks.length > 0 || this.resync > 0 || this.stuck > 0;
    if (has) {
      const props: StudioPerfSampleProps = {
        host: 'mm',
        slots: this.maxSlots,
        safeMode: this.safe,
        deviceClass: this.deps.deviceClass,
      };
      if (this.fps.length > 0) props.fpsBucket = fpsBucket(percentile(this.fps, 50));
      if (this.dropped.length > 0) props.droppedFrameRatioBucket = droppedFrameRatioBucket(percentile(this.dropped, 50));
      if (this.seeks.length > 0) props.seekLatencyP95Bucket = latencyMsBucket(percentile(this.seeks, 95));
      if (this.deps.gpuUnavailable()) props.webglFallback = true;
      if (this.resync > 0) props.resyncSeeks = countBucket(this.resync);
      if (this.stuck > 0) props.stuckRecoveries = countBucket(this.stuck);
      const heap = jsHeapMbBucket(this.deps.heapBytes());
      if (heap) props.jsHeapMbBucket = heap;
      try {
        this.deps.send(props);
        this.sent += 1;
      } catch {
        // analytics never breaks the preview
      }
    }
    this.fps = [];
    this.dropped = [];
    this.seeks = [];
    this.resync = 0;
    this.stuck = 0;
    this.maxSlots = 0;
    this.playedMs = 0;
  }

  private push(arr: number[], v: number): void {
    if (!Number.isFinite(v)) return;
    arr.push(v);
    if (arr.length > MAX_SAMPLES) arr.shift();
  }
}
