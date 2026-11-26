/**
 * MA62 S4: safe-mode entry and exit rules with a fake fps source (decision 11), and the perf
 * telemetry aggregation (decision 12): 60 s windows of playing time, the web's buckets, the app's
 * four props, never per frame.
 */
import {
  initialSafeMode,
  LOW_FPS_FOR_MS,
  onCapability,
  onFps,
  onToggle,
  type SafeModeReason,
  type SafeModeState,
} from '../safeMode';
import {
  countBucket,
  deviceClassOf,
  droppedFrameRatioBucket,
  fpsBucket,
  jsHeapMbBucket,
  latencyMsBucket,
  PerfAggregator,
  PERF_WINDOW_MS,
} from '../perf';
import type { StudioPerfSampleProps } from '@/analytics/events';

/** Feeds one fps reading per second from `fpsAt(ms)` for `ms`, collecting reports. */
function run(s0: SafeModeState, fpsAt: (ms: number) => number, ms: number, playing = true, t0 = 0) {
  let s = s0;
  const reports: SafeModeReason[] = [];
  for (let t = t0; t <= t0 + ms; t += 1000) {
    const step = onFps(s, fpsAt(t), playing, t);
    s = step.state;
    if (step.report) reports.push(step.report);
  }
  return { s, reports };
}

describe('safe mode', () => {
  it('a GPU that is unavailable enters at once, reported once; the toggle cannot leave it', () => {
    let s = initialSafeMode();
    const a = onCapability(s, 'unavailable');
    expect(a.report).toBe('gpu_unavailable');
    s = a.state;
    expect(s.on).toBe(true);
    expect(onToggle(s, false, 'unavailable').state.on).toBe(true);
    expect(onCapability(s, 'unavailable').report).toBeNull();
  });

  it('ok or unknown capability changes nothing', () => {
    expect(onCapability(initialSafeMode(), 'ok').state.on).toBe(false);
    expect(onCapability(initialSafeMode(), null).state.on).toBe(false);
  });

  it('fps under 15 for 5 s while playing enters (low_fps), not before', () => {
    const just = run(initialSafeMode(), () => 12, LOW_FPS_FOR_MS - 1000);
    expect(just.s.on).toBe(false);
    const enough = run(initialSafeMode(), () => 12, LOW_FPS_FOR_MS);
    expect(enough.s.on).toBe(true);
    expect(enough.reports).toEqual(['low_fps']);
  });

  it('a recovery above 15 resets the 5 s window; paused readings never count', () => {
    const dips = run(initialSafeMode(), (t) => (t % 4000 === 0 ? 20 : 10), 20_000);
    expect(dips.s.on).toBe(false);
    const paused = run(initialSafeMode(), () => 3, 20_000, false);
    expect(paused.s.on).toBe(false);
  });

  it('the toggle enters (user_toggle) and leaves; each reason is reported once per session', () => {
    let s = initialSafeMode();
    let step = onToggle(s, true, 'ok');
    expect(step.report).toBe('user_toggle');
    s = onToggle(step.state, false, 'ok').state;
    expect(s.on).toBe(false);
    step = onToggle(s, true, 'ok');
    expect(step.state.on).toBe(true);
    expect(step.report).toBeNull(); // already reported this session
    s = onToggle(step.state, false, 'ok').state;
    const low = run(s, () => 5, LOW_FPS_FOR_MS);
    expect(low.reports).toEqual(['low_fps']);
  });

  it('once on, fps readings do nothing (no flapping)', () => {
    const on = onToggle(initialSafeMode(), true, 'ok').state;
    expect(run(on, () => 60, 30_000).s).toEqual(on);
  });
});

describe('perf telemetry', () => {
  it('the web buckets', () => {
    expect([14.9, 15, 29.9, 30, 44, 45, 54, 55].map(fpsBucket)).toEqual(['<15', '15-30', '15-30', '30-45', '30-45', '45-55', '45-55', '55+']);
    expect([0, 0.005, 0.01, 0.05, 0.2].map(droppedFrameRatioBucket)).toEqual(['0', '<1%', '1-5%', '5-15%', '15%+']);
    expect([10, 50, 200, 500, 1000].map(latencyMsBucket)).toEqual(['<50ms', '50-200ms', '200-500ms', '500ms-1s', '1s+']);
    expect([0, 1, 10, 11, 51, 201].map(countBucket)).toEqual(['0', '1-10', '1-10', '11-50', '51-200', '200+']);
  });

  it('device class from total RAM, heap bucket from bytes', () => {
    const GB = 1024 ** 3;
    expect([null, 3 * GB, 6 * GB, 12 * GB].map(deviceClassOf)).toEqual(['unknown', 'low', 'mid', 'high']);
    expect([null, 10 * 2 ** 20, 100 * 2 ** 20, 300 * 2 ** 20, 600 * 2 ** 20].map(jsHeapMbBucket)).toEqual([undefined, '<64', '64-128', '256-512', '512+']);
  });

  function agg(over: Partial<{ gpu: boolean; heap: number | null }> = {}) {
    const sent: StudioPerfSampleProps[] = [];
    const a = new PerfAggregator({
      send: (p) => sent.push(p),
      heapBytes: () => over.heap ?? 40 * 2 ** 20,
      deviceClass: 'high',
      gpuUnavailable: () => over.gpu ?? false,
    });
    return { a, sent };
  }

  it('one sample per 60 s of PLAYING time; paused time does not count', () => {
    const { a, sent } = agg();
    let now = 0;
    for (let k = 0; k < 30; k += 1) a.sample({ nowMs: (now += 1000), playing: true, fps: 30, droppedRatio: 0, slots: 2, safeMode: false });
    for (let k = 0; k < 120; k += 1) a.sample({ nowMs: (now += 1000), playing: false, fps: 0, droppedRatio: 0, slots: 0, safeMode: false });
    expect(sent).toHaveLength(0);
    for (let k = 0; k < 31; k += 1) a.sample({ nowMs: (now += 1000), playing: true, fps: 28, droppedRatio: 0.02, slots: 3, safeMode: false });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      host: 'mm',
      slots: 3,
      safeMode: false,
      deviceClass: 'high',
      fpsBucket: '15-30',
      droppedFrameRatioBucket: '1-5%',
      jsHeapMbBucket: '<64',
    });
    expect(PERF_WINDOW_MS).toBe(60_000);
  });

  it('counts, seek latency p95, GPU fallback and safe mode ride along; flush sends the remainder', () => {
    const { a, sent } = agg({ gpu: true });
    a.sample({ nowMs: 0, playing: true, fps: 12, droppedRatio: 0.3, slots: 1, safeMode: true, seekLatenciesMs: [90, 120, 700], resyncSeeks: 3, stuckRecoveries: 1 });
    a.sample({ nowMs: 1000, playing: true, fps: 13, droppedRatio: 0.3, slots: 1, safeMode: true });
    a.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      webglFallback: true,
      safeMode: true,
      slots: 1,
      seekLatencyP95Bucket: '500ms-1s',
      resyncSeeks: '1-10',
      stuckRecoveries: '1-10',
      fpsBucket: '<15',
    });
    a.flush();
    expect(sent).toHaveLength(1); // nothing new: nothing sent
  });

  it('a throwing sender never breaks the preview', () => {
    const a = new PerfAggregator({ send: () => { throw new Error('x'); }, heapBytes: () => null, deviceClass: 'unknown', gpuUnavailable: () => false });
    a.sample({ nowMs: 0, playing: true, fps: 30, droppedRatio: 0, slots: 1, safeMode: false });
    expect(() => a.flush()).not.toThrow();
  });
});
