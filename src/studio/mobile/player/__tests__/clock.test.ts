import { AUDIO_RESYNC_S, MIN_RESEEK_MS, SETTLE_MS } from '../../../playbackSync';
import { Clock, DRIFT_DEAD_BAND_FRAMES, MASTER_SLEW, pickMaster, planDrift, type DriftInput } from '../Clock';

const input = (over: Partial<DriftInput> = {}): DriftInput => ({
  current: 5,
  target: 5,
  baseRate: 1,
  fps: 30,
  nowMs: 10_000,
  lastSeekAtMs: null,
  landedAtMs: null,
  seekPending: false,
  latencyMs: 100,
  isMaster: false,
  ...over,
});

describe('planDrift: seek-only, 2-frame dead band (MA62 decision 0)', () => {
  const frame = 1 / 30;

  it('holds inside 2 frames either way', () => {
    expect(DRIFT_DEAD_BAND_FRAMES).toBe(2);
    expect(planDrift(input({ current: 5 + 2 * frame - 1e-6 })).kind).toBe('hold');
    expect(planDrift(input({ current: 5 - 2 * frame + 1e-6 })).kind).toBe('hold');
  });

  it('seeks past 2 frames, aimed ahead by the measured latency', () => {
    const a = planDrift(input({ current: 5 - 3 * frame, latencyMs: 120 }));
    expect(a.kind).toBe('seek');
    if (a.kind === 'seek') expect(a.time).toBeCloseTo(5.12, 9);
  });

  it('never returns a rate (there is none to set)', () => {
    for (const d of [-1, -0.2, -0.05, 0.05, 0.2, 1]) {
      const a = planDrift(input({ current: 5 + d }));
      expect(Object.keys(a).sort()).toEqual(a.kind === 'seek' ? ['drift', 'kind', 'time'] : ['drift', 'kind']);
    }
  });

  it('does not stack on a seek in flight, nor re-seek inside the cooldown or settle time', () => {
    const far = { current: 4 };
    expect(planDrift(input({ ...far, seekPending: true })).kind).toBe('hold');
    expect(planDrift(input({ ...far, lastSeekAtMs: 10_000 - MIN_RESEEK_MS + 1 })).kind).toBe('hold');
    expect(planDrift(input({ ...far, lastSeekAtMs: 0, landedAtMs: 10_000 - SETTLE_MS + 1 })).kind).toBe('hold');
    expect(planDrift(input({ ...far, lastSeekAtMs: 0, landedAtMs: 0 })).kind).toBe('seek');
  });

  it('pulls the master back only past the audio resync bound', () => {
    expect(planDrift(input({ current: 5 - (AUDIO_RESYNC_S - 0.01), isMaster: true })).kind).toBe('hold');
    expect(planDrift(input({ current: 5 - (AUDIO_RESYNC_S + 0.01), isMaster: true })).kind).toBe('seek');
  });

  it('measures drift in timeline seconds for a fast clip and keeps seeks inside the media', () => {
    expect(planDrift(input({ current: 5.1, baseRate: 4 })).kind).toBe('hold'); // 0.025 s on the timeline
    const a = planDrift(input({ current: 9, target: 9.98, maxTime: 10, latencyMs: 500 }));
    expect(a.kind === 'seek' && a.time).toBeCloseTo(9.95, 9);
  });
});

describe('pickMaster', () => {
  it('is the top-most audible, ready play slot; else the timer (-1)', () => {
    expect(
      pickMaster([
        { slot: 0, priority: 1000, gain: 1, ready: true },
        { slot: 1, priority: 1001, gain: 0.5, ready: true },
      ]),
    ).toBe(1);
    expect(
      pickMaster([
        { slot: 0, priority: 1000, gain: 1, ready: true },
        { slot: 1, priority: 1001, gain: 0, ready: true },
      ]),
    ).toBe(0);
    expect(pickMaster([{ slot: 2, priority: 5, gain: 1, ready: false }])).toBe(-1);
    expect(pickMaster([])).toBe(-1);
  });
});

describe('Clock', () => {
  it('runs on the monotonic timer without a master', () => {
    const c = new Clock(0, 100);
    c.play(0);
    c.tick(100, -1, null);
    c.tick(250, -1, null);
    expect(c.t).toBeCloseTo(0.25, 9);
  });

  it('follows the master once it has two readings', () => {
    const c = new Clock(1, 100);
    c.play(0);
    c.tick(100, 0, 1.0); // first reading: timer step
    expect(c.t).toBeCloseTo(1.1, 9);
    c.tick(200, 0, 1.05); // the audio clock moved 50 ms in 100 ms of display time
    // + 50 ms, then half of the remaining gap to the master's 1.05 closed (MASTER_SLEW).
    expect(c.t).toBeCloseTo(1.15 + (1.05 - 1.15) * MASTER_SLEW, 9);
    for (let k = 3; k < 30; k += 1) c.tick(k * 100, 0, 1.05 + (k - 2) * 0.1);
    expect(c.t).toBeCloseTo(1.05 + 27 * 0.1, 6);
  });

  it('falls back to the timer when the master stalls or jumps', () => {
    const c = new Clock(0, 100);
    c.play(0);
    c.tick(100, 0, 0);
    c.tick(300, 0, 0); // stalled 200 ms
    expect(c.t).toBeCloseTo(0.3, 9);
    c.tick(400, 0, 5); // implausible jump
    expect(c.t).toBeCloseTo(0.4, 9);
  });

  it('a master change does not jump the playhead', () => {
    const c = new Clock(2, 100);
    c.play(0);
    c.tick(100, 0, 2.1);
    c.tick(200, 1, 7.5);
    expect(c.t).toBeCloseTo(2.2, 9);
  });

  it('stops at the end; play from the end restarts at 0; seek clamps', () => {
    const c = new Clock(9.95, 10);
    c.play(0);
    expect(c.tick(100, -1, null)).toBe(true);
    expect([c.t, c.playing]).toEqual([10, false]);
    c.play(200);
    expect(c.t).toBe(0);
    c.seek(-3);
    expect(c.t).toBe(0);
    c.seek(42);
    expect(c.t).toBe(10);
  });
});
